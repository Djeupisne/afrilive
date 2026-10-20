-- Ajout du flag de gel administratif des wallets (garde WALLET_FROZEN sur
-- toutes les écritures : credit/debit/withdraw/convert/transfer).
-- Générée hors ligne (aucune instance Postgres en dev) — à appliquer avec
-- `prisma migrate deploy` dès que la base est disponible, comme 0001_init.

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "frozen" BOOLEAN NOT NULL DEFAULT false;
