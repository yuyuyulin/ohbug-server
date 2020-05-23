import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  orm: {
    type: 'postgres',
    host: process.env.TYPEORM_HOST,
    port: parseInt(process.env.TYPEORM_PORT, 10),
    database: process.env.TYPEORM_DATABASE,
    username: process.env.TYPEORM_USERNAME,
    password: process.env.TYPEORM_PASSWORD,
    entities: ['dist/**/*.entity{.ts,.js}'],
    autoLoadEntities: true,
    synchronize: true,
    cache: {
      duration: 30000, // 30 seconds
    },
    logging: process.env.NODE_ENV === 'production' ? false : true,
  },
  elasticsearch: {
    node: process.env.ELASTICSEARCH_NODE,
    auth: {
      username: process.env.ELASTICSEARCH_USERNAME,
      password: process.env.ELASTICSEARCH_PASSWORD,
    },
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT, 10),
  },
}));