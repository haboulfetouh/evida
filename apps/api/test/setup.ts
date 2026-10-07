// Test environment defaults. Integration tests use a dedicated database (never production data).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://evida@localhost:5432/evida_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/1';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789';
process.env.JITSI_APP_SECRET = 'test-jitsi-secret';
process.env.JITSI_WEBHOOK_SECRET = 'test-jitsi-webhook';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.LOG_LEVEL = 'silent';
process.env.S3_ENDPOINT = 'http://127.0.0.1:9';
