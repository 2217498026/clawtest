import { _ } from '../helper.js'

export default {
  title: _('状态通知', 'Status', '狀態通知', 'ステータス通知', '상태 알림'),

  // ── Guardian ──
  guardian: {
    title: _('守护进程', 'Guardian', '守護進程', 'ガーディアン', '가디언'),
    guardian_started: _('守护进程已启动', 'Guardian started', '守護進程已啟動', 'ガーディアン起動', '가디언 시작됨'),
    gateway_starting: _('Gateway 启动中...', 'Gateway starting...', 'Gateway 啟動中...', 'Gateway 起動中...', 'Gateway 시작 중...'),
    gateway_restarted: _('Gateway 已重启', 'Gateway restarted', 'Gateway 已重啟', 'Gateway 再起動', 'Gateway 재시작됨'),
    auto_fix_start: _('正在自动修复配置...', 'Auto-fixing config...', '正在自動修復設定...', '設定を自動修復中...', '자동 수정 중...'),
    auto_fix_retry: _('修复完成，正在重试启动 Gateway...', 'Fix done, retrying Gateway...', '修復完成，正在重試啟動 Gateway...', '修復完了、Gateway 再試行中...', '수정 완료, Gateway 재시도 중...'),
    auto_fix_success: _('自动修复成功，Gateway 已恢复正常', 'Auto-fix succeeded, Gateway is back', '自動修復成功，Gateway 已恢復正常', '自動修復成功、Gateway 正常稼働中', '자동 수정 성공, Gateway 정상'),
    auto_fix_failure: _('自动修复失败', 'Auto-fix failed', '自動修復失敗', '自動修復失敗', '자동 수정 실패'),
    give_up: _('Gateway 反复启动失败，已停止自动拉起', 'Gateway keeps failing, auto-restart stopped', 'Gateway 反覆啟動失敗，已停止自動拉起', 'Gateway の起動が繰り返し失敗、自動再起動停止', 'Gateway 반복 시작 실패, 자동 재시작 중단'),
    restartCount: _('第 {count} 次自动重启', 'Auto restart #{count}', '第 {count} 次自動重啟', '自動再起動 #{count}', '자동 재시작 #{count}'),
    waiting_restart: _('冷却中，{seconds}秒后重试', 'Cooling down, retry in {seconds}s', '冷卻中，{seconds}秒後重試', 'クールダウン中、{seconds}秒後に再試行', '쿨다운 중, {seconds}초 후 재시도'),
  },

  // ── Gateway ──
  gateway: {
    title: _('网关', 'Gateway', '閘道', 'ゲートウェイ', '게이트웨이'),
    running: _('Gateway 运行中', 'Gateway running', 'Gateway 執行中', 'Gateway 稼働中', 'Gateway 실행 중'),
    started: _('Gateway 已启动', 'Gateway started', 'Gateway 已啟動', 'Gateway 起動', 'Gateway 시작됨'),
    stopped: _('Gateway 已停止', 'Gateway stopped', 'Gateway 已停止', 'Gateway 停止', 'Gateway 중지됨'),
    startFailed: _('Gateway 启动失败', 'Gateway start failed', 'Gateway 啟動失敗', 'Gateway 起動失敗', 'Gateway 시작 실패'),
    foreign: _('Gateway 被外部实例管理', 'Gateway managed by external instance', 'Gateway 被外部實例管理', '外部インスタンスが管理する Gateway', '외부 인스턴스가 관리하는 Gateway'),
  },

  // ── WebSocket ──
  ws: {
    title: _('WS 连接', 'WS Connection', 'WS 連線', 'WS 接続', 'WS 연결'),
    connecting: _('正在连接 WebSocket...', 'Connecting WebSocket...', '正在連線 WebSocket...', 'WebSocket 接続中...', 'WebSocket 연결 중...'),
    handshaking: _('握手认证中...', 'Handshaking...', '握手認證中...', 'ハンドシェイク中...', '핸드셰이크 중...'),
    connected: _('WebSocket 已连接', 'WebSocket connected', 'WebSocket 已連線', 'WebSocket 接続済み', 'WebSocket 연결됨'),
    ready: _('WebSocket 已就绪', 'WebSocket ready', 'WebSocket 已就緒', 'WebSocket 準備完了', 'WebSocket 준비됨'),
    disconnected: _('WebSocket 已断开', 'WebSocket disconnected', 'WebSocket 已斷開', 'WebSocket 切断', 'WebSocket 연결 끊김'),
    reconnecting: _('第 {attempt} 次重连中...', 'Reconnecting #{attempt}...', '第 {attempt} 次重連中...', '再接続 #{attempt}...', '재연결 #{attempt}...'),
    reconnectSuccess: _('WebSocket 重连成功', 'WebSocket reconnected', 'WebSocket 重連成功', 'WebSocket 再接続成功', 'WebSocket 재연결 성공'),
    reconnectFailed: _('WebSocket 重连失败', 'WebSocket reconnect failed', 'WebSocket 重連失敗', 'WebSocket 再接続失敗', 'WebSocket 재연결 실패'),
    heartbeatTimeout: _('心跳超时，即将重连', 'Heartbeat timeout, reconnecting', '心跳逾時，即將重連', 'ハートビートタイムアウト、再接続中', '하트비트 타임아웃, 재연결 예정'),
    giveUp: _('已停止 WebSocket 重连', 'Reconnect stopped', '已停止 WebSocket 重連', '再接続停止', '재연결 중단'),
  },

  // ── 相对时间 ──
  timeAgo: {
    justNow: _('刚刚', 'Just now', '剛剛', 'たった今', '방금'),
    secondsAgo: _('{n}秒前', '{n}s ago', '{n}秒前', '{n}秒前', '{n}초 전'),
    minutesAgo: _('{n}分钟前', '{n}m ago', '{n}分鐘前', '{n}分前', '{n}분 전'),
    hoursAgo: _('{n}小时前', '{n}h ago', '{n}小時前', '{n}時間前', '{n}시간 전'),
  },
}
