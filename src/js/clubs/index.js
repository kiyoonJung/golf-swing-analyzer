/**
 * clubs/index.js — 클럽 프로필 등록소
 * 새 클럽(어프로치, 퍼팅 등)은 파일을 하나 만들고 여기에 등록하면 화면 선택지에 자동으로 나타난다.
 */
import driver from './driver.js';
import iron from './iron.js';

export const CLUBS = { driver, iron };
export const DEFAULT_CLUB = 'driver';
