import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { ClientKafka } from '@nestjs/microservices';
import { OhbugEvent } from '@ohbug/types';
import dayjs from 'dayjs';
import { ElasticsearchService } from '@nestjs/elasticsearch';

import { ForbiddenException, KafkaEmitCallback } from '@ohbug-server/common';
import type {
  OhbugEventLike,
  OhbugEventLikeWithIssueId,
} from '@ohbug-server/common';
import { IssueService } from '@/core/issue/issue.service';

import type { GetEventByEventId, OhbugEventDetail } from './event.interface';
import {
  getMd5FromAggregationData,
  switchErrorDetailAndGetAggregationDataAndMetaData,
  eventIndices,
} from './event.core';

@Injectable()
export class EventService {
  constructor(
    @InjectQueue('document') private documentQueue: Queue,
    private readonly elasticsearchService: ElasticsearchService,
    @Inject(forwardRef(() => IssueService))
    private readonly issueService: IssueService,
  ) {}

  @Inject('KAFKA_MANAGER_LOGSTASH_CLIENT')
  private readonly logstashClient: ClientKafka;

  /**
   * 对 event 进行聚合 生成 issue
   * 根据堆栈信息进行 md5 加密得到 hash
   *
   * @param event
   */
  aggregation(event: OhbugEventLike) {
    try {
      const { type, detail, apiKey } = event;
      if (typeof detail === 'string') {
        const formatDetail: OhbugEventDetail = JSON.parse(detail);
        const {
          agg,
          metadata,
        } = switchErrorDetailAndGetAggregationDataAndMetaData(
          type,
          formatDetail,
        );
        const intro = getMd5FromAggregationData(apiKey, ...agg);
        return { intro, metadata };
      }
    } catch (error) {
      throw new ForbiddenException(4001003, error);
    }
  }

  getIndexOrKeyByEvent(event: OhbugEvent<any> | OhbugEventLike) {
    const { category, key, index } = eventIndices.find(
      (item) => item.category === event?.category,
    );
    return {
      category,
      key,
      index: `${index}-${dayjs().format('YYYY.MM.DD')}`,
    };
  }

  /**
   * 1. 分类后传递到 elk
   *
   * @param key
   * @param value
   */
  async passEventToLogstash(
    key: string,
    value: OhbugEventLikeWithIssueId,
  ): Promise<KafkaEmitCallback> {
    try {
      const result = await this.logstashClient
        .emit(key, {
          key,
          value,
        })
        .toPromise<KafkaEmitCallback>();
      return result;
      throw new Error(
        `传入 logstash 失败，请确认 category 是否为指定内容: 'error', 'message', 'feedback', 'view', 'performance'
        ${JSON.stringify(value)}
        `,
      );
    } catch (error) {
      throw new ForbiddenException(4001001, error);
    }
  }

  async handleEvent(eventLike: OhbugEventLike): Promise<void> {
    await this.documentQueue.add('event', eventLike, {
      delay: 3000,
    });
  }

  /**
   * 删除 index
   *
   * @param interval
   * @param index
   */
  async deleteEvents(interval: string, index: string | string[]) {
    try {
      return await this.elasticsearchService.delete_by_query({
        index,
        body: {
          query: {
            range: {
              '@timestamp': {
                lt: `now-${interval}d`,
                format: 'epoch_millis',
              },
            },
          },
        },
      });
    } catch (error) {
      throw new ForbiddenException(4001005, error);
    }
  }

  /**
   * 根据 event_id 查询 event
   *
   * @param id
   */
  async getEventByEventId({ event_id, issue_id }: GetEventByEventId) {
    try {
      const issue = await this.issueService.getIssueByIssueId({ issue_id });
      const index = issue.events.find((e) => e.document_id === event_id)?.index;
      if (index) {
        const {
          body: {
            _source: { event: eventLike },
          },
        } = await this.elasticsearchService.get(
          {
            index,
            id: event_id,
          },
          {
            ignore: [404],
            maxRetries: 3,
          },
        );
        const eventIndex = issue.events.findIndex(
          (e) => e.document_id === event_id && e.index === index,
        );
        const previousEvent = issue.events[eventIndex - 1];
        const nextEvent = issue.events[eventIndex + 1];

        const event = eventLike;
        if (event_id) {
          event.id = event_id;
        }
        if (index) {
          event.index = index;
        }
        event.previous = previousEvent || undefined;
        event.next = nextEvent || undefined;
        if (typeof event.detail === 'string') {
          event.detail = JSON.parse(event.detail);
        }
        if (typeof event.actions === 'string') {
          event.actions = JSON.parse(event.actions);
        }
        if (typeof event.metaData === 'string') {
          event.metaData = JSON.parse(event.metaData);
        }

        return event;
      }
    } catch (error) {
      throw new ForbiddenException(400305, error);
    }
  }
}
