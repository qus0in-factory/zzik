import { observeActivity } from './activity'
import type { ActivityObservation } from './activity'

/**
 * 카드별 직전 관측값과 달리기(속도·만료 시각)를 카드 컴포넌트 밖에 보관한다.
 * 탭 전환처럼 카드가 언마운트돼도 같은 id의 기록이 남아 다음 관측의 기준값이 된다.
 * 시계·스케줄러는 훅이 계속 주입받고, 이 스토어는 순수한 id별 맵만 맡는다.
 */
export interface CardActivityStore {
  observe(id: string, usedPercent: number | null, now: number): ActivityObservation
}

export function createCardActivityStore(): CardActivityStore {
  const observations = new Map<string, ActivityObservation>()
  return {
    observe(id, usedPercent, now) {
      const observation = observeActivity(observations.get(id), usedPercent, now)
      observations.set(id, observation)
      return observation
    },
  }
}
