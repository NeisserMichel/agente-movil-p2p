#!/bin/sh
# Recrea la base de prueba, carga Supabase simulado + schema.sql (dos veces) y corre los flujos.
set -e
cd "$(dirname "$0")/.."
PSQL="psql -h /tmp/pg -p 5544 -U postgres -v ON_ERROR_STOP=1 -q"
psql -h /tmp/pg -p 5544 -U postgres -qc "drop database if exists t" -c "create database t"
$PSQL -d t -f tests/stubs.sql
$PSQL -d t -f schema.sql >/dev/null 2>&1
$PSQL -d t -f schema.sql >/dev/null 2>&1
python3 tests/test_flujos.py
