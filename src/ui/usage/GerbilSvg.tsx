import type { ReactNode } from 'react'

/**
 * 인라인 SVG 몽골리안 저빌 (옆모습, 오른쪽을 본다).
 * 둥근 몸통, 뾰족한 주둥이, 둥근 귀, 큰 뒷다리 2개와 작은 앞다리 2개, 끝이 술처럼 갈라진 긴 꼬리로 구성되며 currentColor를 사용한다.
 * 눈은 배경(--card)색으로 파내서 라이트·다크 테마 모두에서 보인다.
 */
export function GerbilSvg({ className }: { className?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 32 20"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* 꼬리: 몸 뒤에서 길게 뻗고 끝이 술처럼 갈라진다 */}
      <path
        d="M9 10.5 C 6 10.5, 4 8.5, 2.5 6 L 0.8 6.2 L 1.8 4.8 L 0.6 3.4 L 3 3.8 C 4.5 6, 6.5 7.6, 10 8 Z"
        className="gerbil-part-tail"
      />
      {/* 몸통 */}
      <ellipse cx="16" cy="11" rx="8.5" ry="5" className="gerbil-part-body" />
      {/* 머리와 주둥이 */}
      <circle cx="25" cy="9.5" r="3.6" className="gerbil-part-head" />
      <polygon points="26.5,7.6 31.4,10.6 26.5,12.6" className="gerbil-part-snout" />
      {/* 귀 */}
      <circle cx="23.4" cy="6.3" r="1.9" className="gerbil-part-ear" />
      {/* 눈 */}
      <circle cx="26.6" cy="8.9" r="0.75" fill="var(--card)" />
      {/* 다리 4개 (뒷다리는 굵고 길게, 앞다리는 가늘게: CSS keyframes로 교차 달리기) */}
      <rect x="8.5" y="12.5" width="2.8" height="6.8" rx="1.3" className="gerbil-leg gerbil-leg-back-left" />
      <rect x="12" y="13" width="2.8" height="6.3" rx="1.3" className="gerbil-leg gerbil-leg-back-right" />
      <rect x="19.5" y="13.5" width="1.8" height="5.8" rx="0.9" className="gerbil-leg gerbil-leg-front-left" />
      <rect x="22.5" y="13.5" width="1.8" height="5.8" rx="0.9" className="gerbil-leg gerbil-leg-front-right" />
    </svg>
  )
}

/**
 * 자는 저빌(동그랗게 웅크린 옆모습): 0%일 때 막대 시작점에 놓는다.
 * 몸(.gerbil-sleep-body)은 호흡만 하고, 머리(.gerbil-sleep-head)는 가끔 고개를 들어 왼쪽→오른쪽으로 돌린다.
 * 깬 구간에는 감은 눈을 숨기고 뜬 눈·눈동자를 좌우로 움직이며, 귀(.gerbil-sleep-ear)가 살짝 선다.
 * z 3개(.gerbil-sleep-z-1~3)가 크기·투명도·위치를 달리하며 차례로 떠오르고, 깨는 동안 .gerbil-sleep-zzz가 숨는다.
 * 모든 연출은 CSS keyframes의 transform/opacity만 써서 레이아웃(measure-layout)에 영향이 없다.
 */
export function SleepingGerbilSvg({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 32 20" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* 둥글게 말린 몸통과 몸을 감싼 꼬리: 호흡만 */}
      <g className="gerbil-sleep-body">
        <ellipse cx="13" cy="14" rx="10" ry="5.2" />
        <path d="M3.5 16 C 2 19.4, 10 19.8, 17 18.6 C 11 19, 5.5 18.6, 3.5 16 Z" />
      </g>
      {/* 머리·주둥이·귀·눈: 목(.gerbil-sleep-head의 transform-origin)을 축으로 고개를 들고 좌우로 돌린다 */}
      <g className="gerbil-sleep-head">
        <circle cx="21.5" cy="13.4" r="3.8" />
        <polygon points="23,12.2 27.4,14.6 23,16" />
        {/* 귀: 깨기 시작·끝에 뿌리를 축으로 살짝 선다 */}
        <g className="gerbil-sleep-ear">
          <circle cx="19.6" cy="10.4" r="1.8" />
        </g>
        {/* 감은 눈(자는 동안) / 뜬 눈 + 눈동자(깬 동안): opacity로 교대 */}
        <path className="gerbil-sleep-eye-closed" d="M21.6 13 Q 22.8 14 24 13" fill="none" stroke="var(--card)" strokeWidth="0.9" strokeLinecap="round" />
        <g className="gerbil-sleep-eye-open">
          <ellipse cx="22.9" cy="12.9" rx="2.2" ry="1.3" fill="var(--card)" />
          <circle className="gerbil-sleep-eye-pupil" cx="22.9" cy="12.9" r="0.7" />
        </g>
      </g>
      {/* zzz: 크기·위치가 다른 z 3개가 서로 다른 위상으로 떠오른다 */}
      <g className="gerbil-sleep-zzz">
        <text x="26.5" y="7.5" fontSize="4" fontWeight="700" className="gerbil-sleep-z gerbil-sleep-z-1">z</text>
        <text x="28.6" y="4.8" fontSize="5.5" fontWeight="700" className="gerbil-sleep-z gerbil-sleep-z-2">z</text>
        <text x="30.6" y="2.2" fontSize="7" fontWeight="700" className="gerbil-sleep-z gerbil-sleep-z-3">z</text>
      </g>
    </svg>
  )
}
