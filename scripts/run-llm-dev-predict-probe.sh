#!/usr/bin/env bash
# Apply fe-demo Predict UI probe Job in llm-dev and stream logs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/config-llm-dev}"
export KUBECONFIG
NS=llm-dev
JOB=fe-demo-predict-ui-probe
CM=fe-demo-predict-probe-scripts
LOG="${ROOT}/evidence/predict-llm-dev/cluster-probe.log"

mkdir -p "$(dirname "$LOG")"

echo "Using KUBECONFIG=$KUBECONFIG"
kubectl -n "$NS" create configmap "$CM" \
  --from-file=predict-ui-probe.mjs="${ROOT}/scripts/predict-ui-probe.mjs" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" delete job "$JOB" --ignore-not-found
kubectl -n "$NS" apply -f "${ROOT}/scripts/llm-dev-predict-ui-probe.yaml"

echo "Waiting for job pod..."
kubectl -n "$NS" wait --for=condition=ready pod -l "job-name=$JOB" --timeout=180s 2>/dev/null || true

POD="$(kubectl -n "$NS" get pods -l "job-name=$JOB" -o jsonpath='{.items[0].metadata.name}')"
echo "Pod: $POD"

kubectl -n "$NS" logs -f "job/$JOB" 2>&1 | tee "$LOG" || true
kubectl -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=1200s

if rg -q 'PREDICT_LLM_DEV_PROBE_OK' "$LOG" && rg -q '"ok": true' "$LOG"; then
  echo "LLM_DEV_PREDICT_PROBE_OK — log: $LOG"
  exit 0
fi

echo "LLM_DEV_PREDICT_PROBE_FAIL — see $LOG" >&2
exit 1
