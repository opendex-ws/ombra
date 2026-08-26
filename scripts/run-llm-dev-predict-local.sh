#!/usr/bin/env bash
# Run Predict UI probe in llm-dev against *this* working tree (not a remote branch).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KUBECONFIG="${LLM_DEV_KUBECONFIG:-${HOME}/.kube/config-llm-dev}"
export KUBECONFIG
NS=llm-dev
POD="fe-demo-predict-cards-$(date -u +%Y%m%d%H%M%S)-$$"
OUT="${ROOT}/evidence/predict-llm-dev/probe"
PW_IMAGE="${PW_IMAGE:-mcr.microsoft.com/playwright:v1.52.0-jammy}"
BUNDLE="$(mktemp -t fe-demo-predict-XXXXXX.tgz)"

K() { kubectl --kubeconfig "$KUBECONFIG" -n "$NS" "$@"; }

cleanup() {
  rm -f "$BUNDLE"
  if [ "${KEEP_POD:-0}" = "1" ]; then
    echo "pod kept: $POD"
  else
    K delete pod "$POD" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "packing local fe-demo..."
tar -czf "$BUNDLE" -C "$ROOT" \
  --exclude=node_modules --exclude=.svelte-kit --exclude=.git --exclude=evidence \
  --exclude=.shots --exclude=dist --exclude=build \
  package.json package-lock.json svelte.config.js vite.config.ts tsconfig.json \
  wrangler.types.jsonc worker-configuration.d.ts static src scripts/predict-ui-probe.mjs

echo "starting $POD..."
cat <<EOF | K apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: $POD
  namespace: $NS
  labels: { app: fe-demo-predict-cards }
spec:
  restartPolicy: Never
  imagePullSecrets: [{ name: mirrorreg }]
  tolerations: [{ operator: Exists }]
  automountServiceAccountToken: false
  activeDeadlineSeconds: 1500
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    runAsNonRoot: true
    fsGroup: 1000
    seccompProfile: { type: RuntimeDefault }
  containers:
    - name: probe
      image: $PW_IMAGE
      imagePullPolicy: IfNotPresent
      workingDir: /work
      command: ["sleep", "1400"]
      securityContext:
        allowPrivilegeEscalation: false
        capabilities: { drop: ["ALL"] }
      resources:
        requests: { cpu: "500m", memory: 2Gi }
        limits: { cpu: "2", memory: 4Gi }
      volumeMounts:
        - { name: work, mountPath: /work }
  volumes:
    - { name: work, emptyDir: {} }
EOF

K wait --for=condition=Ready "pod/$POD" --timeout=300s
K cp "$BUNDLE" "$NS/$POD:/work/bundle.tgz"
echo "building + probing in $POD..."
K exec "$POD" -- bash -ceu '
  set -euo pipefail
  mkdir -p /tmp/fe-demo /tmp/probe-out
  tar xzf /work/bundle.tgz -C /tmp/fe-demo --no-same-owner
  cd /tmp/fe-demo
  npm ci --ignore-scripts --no-audit --no-fund
  npm i playwright@1.52.0 --no-audit --no-fund --no-save
  npx vite dev --host 127.0.0.1 --port 4173 --strictPort >/tmp/preview.log 2>&1 &
  for i in $(seq 1 90); do
    curl -sf http://127.0.0.1:4173/predict >/dev/null && break
    sleep 2
  done
  curl -sf http://127.0.0.1:4173/predict >/dev/null || { echo "--- vite log ---"; cat /tmp/preview.log; exit 1; }
  PREDICT_BASE_URL=http://127.0.0.1:4173 PREDICT_PROBE_OUT=/tmp/probe-out node scripts/predict-ui-probe.mjs
  echo "=== PROBE_REPORT ==="
  cat /tmp/probe-out/report.json
'

mkdir -p "$OUT"
for f in desktop-predict.png desktop-discover.png desktop-metrics.json mobile-predict.png mobile-markets.png report.json; do
  K cp "$NS/$POD:/tmp/probe-out/$f" "$OUT/$f" 2>/dev/null || true
done
echo "shots in $OUT"
cat "$OUT/report.json"
test -f "$OUT/desktop-discover.png"
rg -q '"ok": true' "$OUT/report.json"
echo LLM_DEV_PREDICT_CARDS_OK
