#!/usr/bin/env bash
# 假 claude CLI：输出预置 stream-json 行。
# 控制变量：NO_OUT=1 不输出；SLOW_SEC=n 输出前睡 n 秒；EXIT_CODE=n 退出码（默认 0）
if [ "${NO_OUT:-0}" != "1" ]; then
  echo '{"type":"system","subtype":"init","model":"fake"}'
  echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"fake answer"}]}}'
  echo '{"type":"result","subtype":"success","result":"fake answer","is_error":false}'
fi
if [ -n "${SLOW_SEC:-}" ]; then sleep "$SLOW_SEC"; fi
exit "${EXIT_CODE:-0}"
