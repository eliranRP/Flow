# Sourced by scripts/local-ci.sh, after local-ci-guard.sh (it uses `detach`).

# Starts Docker when it is down. In cloud containers dockerd alone can fail with "timeout waiting
# for containerd", so containerd starts first and dockerd is pointed at its socket.
start_docker() {
  local sock=/run/containerd/containerd.sock retried=
  docker info >/dev/null 2>&1 && return 0
  start_dockerd() {
    if [[ -S "$sock" ]]; then
      (detach sudo -n dockerd --containerd="$sock" >/tmp/flow-dockerd.log 2>&1 &)
    else
      (detach sudo -n dockerd >/tmp/flow-dockerd.log 2>&1 &)
    fi
  }
  # The socket file appears before containerd serves it, and dockerd started then exits with
  # "connection refused": ask containerd itself whether it answers.
  containerd_serving() {
    if command -v ctr >/dev/null 2>&1; then
      sudo -n ctr --address "$sock" version >/dev/null 2>&1
    else
      grep -q "containerd successfully booted" /tmp/flow-containerd.log 2>/dev/null
    fi
  }
  if ! pgrep -x dockerd >/dev/null 2>&1; then
    # A socket left from an earlier containerd doesn't mean one is serving: start it whenever
    # none runs. Either way, start dockerd only once containerd answers, for at most 30 seconds.
    if ! pgrep -x containerd >/dev/null 2>&1; then
      (detach sudo -n containerd >/tmp/flow-containerd.log 2>&1 &)
    fi
    for _ in $(seq 1 30); do
      containerd_serving && break
      sleep 1
    done
    start_dockerd
  fi
  for i in $(seq 1 30); do
    docker info >/dev/null 2>&1 && return 0
    # dockerd exits at once when containerd wasn't ready yet; start it once more.
    if [[ -z $retried ]] && (( i >= 5 )) && ! pgrep -x dockerd >/dev/null 2>&1; then
      retried=1
      start_dockerd
    fi
    sleep 1
  done
  return 1
}
