-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "aiProcessedSeq" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "aiSuggestions" JSONB;
