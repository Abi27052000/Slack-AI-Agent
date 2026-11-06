// Prisma CLI config (Prisma 7+): schema/migrations location and the database URL.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Read lazily via process.env so `prisma generate` works without a DATABASE_URL.
    url: process.env.DATABASE_URL,
  },
});
