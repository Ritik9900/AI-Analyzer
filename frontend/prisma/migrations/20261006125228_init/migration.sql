-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "geminiApiKeyEnc" TEXT,
    "geminiApiKeyHint" TEXT,
    "geminiModels" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Position" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticker" TEXT NOT NULL,
    "avgBuyPrice" REAL NOT NULL,
    "quantity" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StrategyReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "positionId" INTEGER,
    "signalsJson" TEXT NOT NULL,
    "outputJson" TEXT NOT NULL,
    "usedMockMl" BOOLEAN NOT NULL,
    "geminiModel" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyReport_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_ticker_key" ON "Position"("ticker");

-- CreateIndex
CREATE INDEX "StrategyReport_ticker_createdAt_idx" ON "StrategyReport"("ticker", "createdAt");
