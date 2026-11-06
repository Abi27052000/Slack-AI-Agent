-- AlterTable
ALTER TABLE "member_analyses" ADD COLUMN     "confidence" TEXT,
ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "usage" JSONB;
