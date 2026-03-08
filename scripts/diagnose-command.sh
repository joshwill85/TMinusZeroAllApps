#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/diagnose-command.sh <label> <command...>

Writes artifacts to:
  .diagnostics/<label>/<timestamp>/

Environment knobs:
  DIAG_DIR                      Base output dir (default: .diagnostics)
  DIAG_INTERVAL_SECS            Metrics polling interval (default: 5)
  DIAG_MAX_SECS                 Max runtime before terminating (default: 0 = no limit)
  DIAG_KILL_GRACE_SECS          Seconds to wait after SIGTERM before SIGKILL (default: 15)
  DIAG_LSOF                     Set to 1 to capture open-file counts (default: 0)
  DIAG_LSOF_INTERVAL_SECS       Open-file polling interval (default: 30)
  DIAG_SAMPLE_AFTER_SECS        After N seconds, capture stack + Node report (default: 60)
  DIAG_SAMPLE_EVERY_SECS        Repeat capture every N seconds after that (default: 300)
  DIAG_SAMPLE_DURATION_SECS     `sample` duration in seconds (default: 5, macOS only)
  DIAG_NODE_REPORT              Set to 0 to disable Node report-on-signal (default: 1)
  DIAG_CPU_PROF                 Set to 1 to enable Node `--cpu-prof` (default: 0)
  DIAG_HEAP_PROF                Set to 1 to enable Node `--heap-prof` (default: 0)

Notes:
  - The placeholder string "__DIAG_RUN_DIR__" in any argument will be replaced with
    the per-run output directory path.
EOF
}

if [[ $# -lt 2 ]]; then
  usage
  exit 2
fi

label="$1"
shift

diag_base_dir="${DIAG_DIR:-"${ROOT_DIR}/.diagnostics"}"
timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
run_dir="${diag_base_dir}/${label}/${timestamp}"

mkdir -p "$run_dir"

export DIAG_RUN_DIR="$run_dir"

cmd=("$@")
expanded_cmd=()
for arg in "${cmd[@]}"; do
  expanded_cmd+=("${arg//__DIAG_RUN_DIR__/${run_dir}}")
done
cmd=("${expanded_cmd[@]}")

meta_file="${run_dir}/meta.txt"
{
  echo "timestamp_utc=${timestamp}"
  echo "label=${label}"
  echo "repo_root=${ROOT_DIR}"
  echo "run_dir=${run_dir}"
  echo "uname=$(uname -a)"
  echo "node=$(node -v 2>/dev/null || true)"
  echo "npm=$(npm -v 2>/dev/null || true)"
  echo "nvmrc=$(cat "${ROOT_DIR}/.nvmrc" 2>/dev/null || true)"
  echo "git_head=$(git rev-parse HEAD 2>/dev/null || true)"
  echo "git_dirty_count=$(git status --porcelain=v1 2>/dev/null | wc -l | tr -d ' ')"
  printf "command="
  printf "%q " "${cmd[@]}"
  echo
} >"$meta_file"

node_version="$(node -v 2>/dev/null || true)"
nvmrc_version="$(cat "${ROOT_DIR}/.nvmrc" 2>/dev/null || true)"
if [[ -n "$node_version" && -n "$nvmrc_version" ]]; then
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  nvmrc_major="${nvmrc_version#v}"
  nvmrc_major="${nvmrc_major%%.*}"
  echo "node_major=${node_major}" >>"$meta_file"
  echo "nvmrc_major=${nvmrc_major}" >>"$meta_file"
  if [[ "$node_major" != "$nvmrc_major" ]]; then
    echo "node_matches_nvmrc=0" >>"$meta_file"
    echo "WARNING: node ${node_version} != .nvmrc ${nvmrc_version}. For comparable results, run: nvm use" >&2
  else
    echo "node_matches_nvmrc=1" >>"$meta_file"
  fi
fi

ps_ok="1"
if ! ps -o pid= -p "$$" >/dev/null 2>&1; then
  ps_ok="0"
fi
echo "ps_available=${ps_ok}" >>"$meta_file"

node_reports_dir="${run_dir}/node-reports"
mkdir -p "$node_reports_dir"

orig_node_options="${NODE_OPTIONS-}"
node_options_extra=()

if [[ "${DIAG_NODE_REPORT:-1}" == "1" ]]; then
  node_options_extra+=(
    "--report-on-signal"
    "--report-signal=SIGUSR2"
    "--report-directory=${node_reports_dir}"
    "--report-filename=node-report-%p.json"
    "--report-compact"
  )
fi

if [[ "${DIAG_CPU_PROF:-0}" == "1" ]]; then
  node_cpu_prof_dir="${run_dir}/node-cpu-prof"
  mkdir -p "$node_cpu_prof_dir"
  node_options_extra+=("--cpu-prof" "--cpu-prof-dir=${node_cpu_prof_dir}")
fi

if [[ "${DIAG_HEAP_PROF:-0}" == "1" ]]; then
  node_heap_prof_dir="${run_dir}/node-heap-prof"
  mkdir -p "$node_heap_prof_dir"
  node_options_extra+=("--heap-prof" "--heap-prof-dir=${node_heap_prof_dir}")
fi

if [[ ${#node_options_extra[@]} -gt 0 ]]; then
  export NODE_OPTIONS="${orig_node_options:+${orig_node_options} }${node_options_extra[*]}"
fi

stdout_file="${run_dir}/stdout.log"
stderr_file="${run_dir}/stderr.log"
metrics_file="${run_dir}/metrics.csv"

echo "timestamp_utc,elapsed_s,pid,pgid,pcpu,pmem,rss_kb,vsz_kb,pcpu_group,rss_kb_group,vsz_kb_group,proc_count_group,open_files" >"$metrics_file"

echo "Diagnostics output: ${run_dir}" >&2
echo "Running: ${cmd[*]}" >&2

start_epoch="$(date +%s)"
"${cmd[@]}" >"$stdout_file" 2>"$stderr_file" &
child_pid="$!"

pgid=""
if [[ "$ps_ok" == "1" ]]; then
  pgid="$(ps -o pgid= -p "$child_pid" 2>/dev/null | awk '{print $1}' | tr -d ' ' || true)"
fi
echo "child_pid=${child_pid}" >>"$meta_file"
echo "child_pgid=${pgid}" >>"$meta_file"

interval_secs="${DIAG_INTERVAL_SECS:-5}"
max_secs="${DIAG_MAX_SECS:-0}"
kill_grace_secs="${DIAG_KILL_GRACE_SECS:-15}"
lsof_enabled="${DIAG_LSOF:-0}"
lsof_interval_secs="${DIAG_LSOF_INTERVAL_SECS:-30}"
sample_after_secs="${DIAG_SAMPLE_AFTER_SECS:-60}"
sample_every_secs="${DIAG_SAMPLE_EVERY_SECS:-300}"
sample_duration_secs="${DIAG_SAMPLE_DURATION_SECS:-5}"

next_lsof_at=0
next_capture_at="$sample_after_secs"
last_open_files=""

capture_snapshot() {
  local elapsed="$1"

  if [[ "$ps_ok" == "1" && -n "$pgid" ]]; then
    ps -axo pid,ppid,pgid,pcpu,pmem,rss,vsz,command \
      | awk -v pgid="$pgid" 'NR==1 || $3==pgid {print}' \
      >"${run_dir}/ps-group-${elapsed}s.txt" 2>/dev/null || true
  fi

  if command -v sample >/dev/null 2>&1; then
    local top_pid
    if [[ "$ps_ok" == "1" && -n "$pgid" ]]; then
      top_pid="$(
        ps -axo pid=,pgid=,pcpu= 2>/dev/null \
          | awk -v pgid="$pgid" '$2==pgid && $3>=max{max=$3; pid=$1} END{print pid}' \
          | tr -d ' ' \
          || true
      )"
    else
      top_pid="$child_pid"
    fi

    if [[ -n "$top_pid" ]]; then
      sample "$top_pid" "$sample_duration_secs" -file "${run_dir}/sample-${elapsed}s-pid${top_pid}.txt" >/dev/null 2>&1 || true
    fi
  fi

  if [[ "${DIAG_NODE_REPORT:-1}" == "1" ]]; then
    if [[ "$ps_ok" == "1" && -n "$pgid" ]]; then
      ps -axo pid=,pgid=,comm= 2>/dev/null \
        | awk -v pgid="$pgid" '$2==pgid && $3=="node" {print $1}' \
        | while read -r node_pid; do
          [[ -n "$node_pid" ]] || continue
          kill -USR2 "$node_pid" 2>/dev/null || true
        done
    else
      kill -USR2 "$child_pid" 2>/dev/null || true
    fi
  fi
}

stop_requested="0"
on_signal() {
  stop_requested="1"
}
trap on_signal INT TERM

while kill -0 "$child_pid" 2>/dev/null; do
  now_epoch="$(date +%s)"
  elapsed="$((now_epoch - start_epoch))"
  now_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  if [[ "$max_secs" != "0" && "$elapsed" -ge "$max_secs" ]]; then
    echo "max_runtime_reached=1 elapsed_s=${elapsed}" >>"$meta_file"
    capture_snapshot "$elapsed"
    kill -TERM "$child_pid" 2>/dev/null || true

    grace_left="$kill_grace_secs"
    while [[ "$grace_left" -gt 0 ]]; do
      if ! kill -0 "$child_pid" 2>/dev/null; then
        break
      fi
      sleep 1
      grace_left="$((grace_left - 1))"
    done

    if kill -0 "$child_pid" 2>/dev/null; then
      echo "sigkill_sent=1 elapsed_s=${elapsed}" >>"$meta_file"
      kill -KILL "$child_pid" 2>/dev/null || true
    fi
    break
  fi

  if [[ "$stop_requested" == "1" ]]; then
    echo "signal_received=1 elapsed_s=${elapsed}" >>"$meta_file"
    capture_snapshot "$elapsed"
    kill -TERM "$child_pid" 2>/dev/null || true
    break
  fi

  pcpu=""
  pmem=""
  rss_kb=""
  vsz_kb=""
  pcpu_group=""
  rss_kb_group=""
  vsz_kb_group=""
  proc_count_group=""

  if [[ "$ps_ok" == "1" ]]; then
    read -r pcpu pmem rss_kb vsz_kb < <(
      ps -o pcpu= -o pmem= -o rss= -o vsz= -p "$child_pid" 2>/dev/null \
        | awk 'NR==1{print $1,$2,$3,$4}' \
        || true
    ) || true
  fi

  if [[ "$ps_ok" == "1" && -n "$pgid" ]]; then
    read -r pcpu_group rss_kb_group vsz_kb_group proc_count_group < <(
      ps -axo pgid=,pcpu=,rss=,vsz= 2>/dev/null \
        | awk -v pgid="$pgid" '
          $1==pgid {cpu+=$2; rss+=$3; vsz+=$4; n+=1}
          END {printf "%.1f %d %d %d\n", cpu+0, rss+0, vsz+0, n+0}
        ' \
        || true
    ) || true
  fi

  if [[ "$lsof_enabled" == "1" && "$elapsed" -ge "$next_lsof_at" ]]; then
    last_open_files="$(lsof -n -P -p "$child_pid" 2>/dev/null | wc -l | tr -d ' ' || true)"
    next_lsof_at="$((elapsed + lsof_interval_secs))"
  fi

  echo "${now_utc},${elapsed},${child_pid},${pgid},${pcpu:-},${pmem:-},${rss_kb:-},${vsz_kb:-},${pcpu_group:-},${rss_kb_group:-},${vsz_kb_group:-},${proc_count_group:-},${last_open_files}" >>"$metrics_file"

  printf '[%s] %ss cpu=%s%% rss=%sKB (group cpu=%s%% procs=%s)\n' \
    "$now_utc" \
    "$elapsed" \
    "${pcpu:-?}" \
    "${rss_kb:-?}" \
    "${pcpu_group:-?}" \
    "${proc_count_group:-?}" \
    >&2

  if [[ "$sample_after_secs" != "0" && "$elapsed" -ge "$next_capture_at" ]]; then
    capture_snapshot "$elapsed"
    next_capture_at="$((elapsed + sample_every_secs))"
  fi

  if ! kill -0 "$child_pid" 2>/dev/null; then
    break
  fi

  sleep_left="$interval_secs"
  while [[ "$sleep_left" -gt 0 ]]; do
    if ! kill -0 "$child_pid" 2>/dev/null; then
      break
    fi
    sleep 1
    sleep_left="$((sleep_left - 1))"
  done
done

set +e
wait "$child_pid"
exit_code="$?"
set -e

end_epoch="$(date +%s)"
duration="$((end_epoch - start_epoch))"
{
  echo "exit_code=${exit_code}"
  echo "duration_s=${duration}"
} >>"$meta_file"

echo "Done (exit ${exit_code}) after ${duration}s. Artifacts: ${run_dir}" >&2
exit "$exit_code"
