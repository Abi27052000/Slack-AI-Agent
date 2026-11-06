-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'RESEARCHING', 'ANALYZING', 'ANALYZED', 'POSTED', 'FAILED');

-- CreateEnum
CREATE TYPE "FitTier" AS ENUM ('HOT', 'WARM', 'COOL', 'COLD');

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT,
    "name" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "title" TEXT,
    "timezone" TEXT,
    "avatar_url" TEXT,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_analyses" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" TEXT NOT NULL DEFAULT 'team_join',
    "fit_score" INTEGER,
    "tier" "FitTier",
    "summary" TEXT,
    "insights" JSONB DEFAULT '[]',
    "recommendations" JSONB DEFAULT '[]',
    "research_data" JSONB DEFAULT '[]',
    "is_fallback" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "prompt_version" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "slack_channel_id" TEXT,
    "slack_message_ts" TEXT,
    "posted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_slack_user_id_key" ON "members"("slack_user_id");

-- CreateIndex
CREATE INDEX "members_email_idx" ON "members"("email");

-- CreateIndex
CREATE INDEX "member_analyses_member_id_created_at_idx" ON "member_analyses"("member_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "member_analyses_status_idx" ON "member_analyses"("status");

-- CreateIndex
CREATE INDEX "member_analyses_fit_score_idx" ON "member_analyses"("fit_score");

-- CreateIndex
CREATE INDEX "member_analyses_created_at_idx" ON "member_analyses"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "member_analyses" ADD CONSTRAINT "member_analyses_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
