/**
 * camera.js
 * 입력 엔진: 라이브 웹캠(MediaRecorder 녹화) + 로컬 영상 파일 업로드
 */

let stream = null;      // 현재 카메라 스트림
let recorder = null;    // MediaRecorder 인스턴스
let chunks = [];        // 녹화 조각
let lastObjectUrl = null; // 메모리 누수 방지를 위해 이전 blob URL 추적

/**
 * 라이브 카메라를 켜고 <video>에 연결
 * @param facingMode 'user'(전면) | 'environment'(후면). 기기에 그 카메라가 없으면(노트북 웹캠 등) 있는 카메라로 대체됨
 */
export async function startCamera(videoEl, facingMode = 'user') {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('이 브라우저는 카메라를 지원하지 않습니다. (HTTPS 또는 localhost 필요)');
  }
  stopCamera(videoEl); // 전/후면 전환 시 이전 스트림을 먼저 해제 (안 하면 일부 기기에서 카메라가 안 열림)
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode },
    audio: false,
  });
  videoEl.removeAttribute('src');
  videoEl.srcObject = stream;
  videoEl.muted = true;
  await videoEl.play();
}

/** 카메라 정지 및 트랙 해제 */
export function stopCamera(videoEl) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (videoEl) videoEl.srcObject = null;
}

/** 녹화 시작 (브라우저가 지원하는 MIME 자동 선택) */
export function startRecording() {
  if (!stream) throw new Error('카메라가 켜져 있지 않습니다.');
  chunks = [];
  const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4']
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();
}

/** 녹화 종료 → 녹화된 영상 Blob 반환 */
export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!recorder || recorder.state === 'inactive') {
      return reject(new Error('진행 중인 녹화가 없습니다.'));
    }
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    recorder.stop();
  });
}

/** 영상 파일/Blob을 재생 가능한 URL로 변환 (이전 URL은 해제) */
export function toObjectUrl(fileOrBlob) {
  if (fileOrBlob instanceof File && !fileOrBlob.type.startsWith('video/')) {
    throw new Error('영상 파일(.mp4 등)만 업로드할 수 있습니다.');
  }
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = URL.createObjectURL(fileOrBlob);
  return lastObjectUrl;
}

/** <video>에 소스를 지정하고 메타데이터 로딩까지 대기 */
export function loadVideo(videoEl, url) {
  return new Promise((resolve, reject) => {
    videoEl.srcObject = null;
    videoEl.onloadedmetadata = () => resolve(videoEl);
    videoEl.onerror = () => reject(new Error('영상을 불러오지 못했습니다: ' + url));
    videoEl.src = url;
    videoEl.load();
  });
}
