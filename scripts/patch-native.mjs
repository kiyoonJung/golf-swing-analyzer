/**
 * patch-native.mjs  —  `npx cap add ios` / `npx cap add android` 를 한 번 실행한 뒤에 돌리는 스크립트. (npm run patch-native)
 * 카메라 권한 문구(iOS Info.plist)와 카메라 권한(Android AndroidManifest.xml)을 추가한다. 여러 번 실행해도 안전.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- iOS: Info.plist ----
const plist = path.join(root, 'ios', 'App', 'App', 'Info.plist');
const IOS_KEYS = {
  NSCameraUsageDescription: '스윙 촬영과 실시간 자세 분석을 위해 카메라가 필요합니다.',
  NSMicrophoneUsageDescription: '영상 촬영 기능을 위해 마이크 접근이 필요합니다.',
  NSPhotoLibraryUsageDescription: '분석할 스윙 영상을 앨범에서 불러오기 위해 필요합니다.',
};
if (fs.existsSync(plist)) {
  let xml = fs.readFileSync(plist, 'utf8');
  const added = [];
  for (const [key, text] of Object.entries(IOS_KEYS)) {
    if (xml.includes(`<key>${key}</key>`)) continue;
    const at = xml.lastIndexOf('</dict>');
    xml = `${xml.slice(0, at)}\t<key>${key}</key>\n\t<string>${text}</string>\n${xml.slice(at)}`;
    added.push(key);
  }
  fs.writeFileSync(plist, xml);
  console.log(added.length ? `✔ iOS Info.plist 추가: ${added.join(', ')}` : '• iOS Info.plist: 이미 설정됨');
} else console.log('• iOS 폴더 없음 (npx cap add ios 를 먼저 실행하세요) — 건너뜀');

// ---- Android: AndroidManifest.xml ----
const manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const ANDROID_LINES = [
  ['android.permission.CAMERA', '<uses-permission android:name="android.permission.CAMERA" />'],
  ['android.hardware.camera"', '<uses-feature android:name="android.hardware.camera" android:required="false" />'],
];
if (fs.existsSync(manifest)) {
  let xml = fs.readFileSync(manifest, 'utf8');
  const added = [];
  for (const [probe, line] of ANDROID_LINES) {
    if (xml.includes(probe)) continue;
    xml = xml.replace('</manifest>', `    ${line}\n</manifest>`);
    added.push(probe.replace(/"$/, ''));
  }
  fs.writeFileSync(manifest, xml);
  console.log(added.length ? `✔ AndroidManifest 추가: ${added.join(', ')}` : '• AndroidManifest: 이미 설정됨');
} else console.log('• Android 폴더 없음 (npx cap add android 를 먼저 실행하세요) — 건너뜀');
