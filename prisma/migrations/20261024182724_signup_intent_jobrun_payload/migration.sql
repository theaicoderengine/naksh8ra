-- AlterTable
ALTER TABLE "AccommodationRequest" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN     "payload" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "signupIntent" TEXT;
