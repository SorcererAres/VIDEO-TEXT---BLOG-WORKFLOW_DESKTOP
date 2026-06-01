#!/usr/bin/env bash
# 收集「合同模板」到目标目录，供打包版首启初始化用户工作目录。
#
# 打包版（.app）的工作目录默认 ~/Documents/Video2Blog，全新时没有写作合同
# （WORKFLOW.md / memory / knowledge / .cursor/skills），改写链 Pre-Flight 会失败。
# 把这些合同模板打进 onedir/contracts/，server 首启自动复制到工作目录（见
# video2blog/app_bootstrap.py），让双击全新 .app 开箱即用。
#
# PREFERENCES/CONFIG 用仓库现成的作默认（用户可在 GUI「风格」里改）；
# HISTORY 用空模板（不带作者历史）；fingerprints 不打包（首启建空）。
#
# 用法：bash scripts/bundle_contracts.sh <目标目录>
set -euo pipefail

DEST="${1:?用法: bundle_contracts.sh <目标目录>}"
cd "$(dirname "$0")/.."

rm -rf "$DEST"
mkdir -p "$DEST/memory" "$DEST/.cursor"

cp WORKFLOW.md "$DEST/"
cp -R knowledge "$DEST/"                 # STYLE_GUIDE + Examples + Prompts
cp -R .cursor/skills "$DEST/.cursor/"    # Step 3–8 SKILL.md（ContextLoader 读）
cp memory/PREFERENCES.md memory/CONFIG.md "$DEST/memory/"
head -5 memory/HISTORY.md > "$DEST/memory/HISTORY.md"   # 空表头模板，无条目

echo "[bundle-contracts] ✓ 合同模板 → $DEST ($(du -sh "$DEST" | cut -f1))"
