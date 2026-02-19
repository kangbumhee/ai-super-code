# BRIEFING §9 보완 (runningCount 및 onReady)

아래 내용을 BRIEFING.md §9(백그라운드)에 반영하세요.

---

## initialize()에서 queue.onReady 제거

- **현재 구현**: `queue.onReady(executeTask)`를 호출하지 않음. background의 `processQueue()`가 직접 `queue.dequeue()` → `executeTask(task)` 루프를 돌림.
- **이유**: `onReady` + `queue.processQueue()`를 사용하면 같은 태스크가 중복 실행될 수 있음. 일원화를 위해 **백그라운드에서만 dequeue → executeTask** 사용.
- **브리핑 문구**: "initialize()에서는 TaskQueue 생성만 하고 onReady(executeTask)는 등록하지 않음. processQueue()가 직접 dequeue 루프에서 executeTask를 호출함."

---

## runningCount 감소 흐름

- **executeTask가 예외를 throw하는 경우**: `processQueue()`의 catch에서 `queue.retry(task.id, ...)`만 호출됨. `updateStatus`는 호출되지 않으므로 **retry() 내부에서 runningCount가 1회 감소**.
- **executeTask가 성공하는 경우**: 내부에서 `queue.updateStatus(task.id, 'completed', ...)` 호출. **updateStatus() 내부에서만 runningCount가 1회 감소** (completed/failed 분기).
- 따라서 성공/실패 경로 모두 **runningCount는 정확히 한 번만 감소**함. 재구현 시 retry()와 updateStatus() 둘 다에서 감소시키지 않도록 주의.
