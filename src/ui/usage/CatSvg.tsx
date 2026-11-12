import type { ReactNode } from 'react'

/**
 * 인라인 SVG 고양이 (옆모습).
 * 몸통, 머리, 귀, 꼬리, 앞다리 2개, 뒷다리 2개로 구성되며 currentColor를 사용한다.
 */
export function CatSvg({ className }: { className?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 32 20"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* 꼬리 (위쪽으로 살짝 말린 형태) */}
      <path
        d="M2 8 C 1 4, 4 2, 6 4 C 7 5, 5 7, 3 8 Z"
        className="cat-part-tail"
      />
      {/* 몸통 (타원형) */}
      <ellipse cx="14" cy="10" rx="9" ry="5.5" className="cat-part-body" />
      {/* 머리 */}
      <circle cx="24" cy="8" r="4.5" className="cat-part-head" />
      {/* 귀 2개 */}
      <polygon points="21,5 23,1 25,4.5" className="cat-part-ear-back" />
      <polygon points="24,4.5 26.5,1 28,5" className="cat-part-ear-front" />
      {/* 다리 4개 (앞다리 2개, 뒷다리 2개: CSS keyframes로 교차 달리기) */}
      <rect x="7" y="13" width="2" height="6" rx="1" className="cat-leg cat-leg-back-left" />
      <rect x="10" y="13" width="2" height="6" rx="1" className="cat-leg cat-leg-back-right" />
      <rect x="17" y="13" width="2" height="6" rx="1" className="cat-leg cat-leg-front-left" />
      <rect x="20" y="13" width="2" height="6" rx="1" className="cat-leg cat-leg-front-right" />
    </svg>
  )
}

/**
 * 자는 고양이(웅크린 옆모습): 0%일 때 막대 시작점에 놓는다.
 * 눈 감은 선과 작은 z가 있고, 호흡은 CSS(.cat-sleep-body)로 은은하게 움직인다.
 */
export function SleepingCatSvg({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 32 20" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* 웅크린 몸통과 꼬리 감싸기 */}
      <g className="cat-sleep-body">
        <ellipse cx="14" cy="14" rx="11" ry="5" />
        <path d="M3 15 C 2 19, 12 19.5, 18 18 C 12 18.5, 5 18, 3 15 Z" />
        {/* 머리와 귀 */}
        <circle cx="22" cy="13" r="4.2" />
        <polygon points="19.5,10.5 20.5,6.5 23,9.5" />
        <polygon points="22.5,9.5 25,6.5 26,10.5" />
        {/* 눈 감은 선(배경색으로 파냄) */}
        <path d="M21 13 Q 22.2 14 23.4 13" fill="none" stroke="var(--card)" strokeWidth="0.9" strokeLinecap="round" />
      </g>
      {/* z */}
      <text x="27" y="6" fontSize="5" fontWeight="700" className="cat-sleep-z">z</text>
    </svg>
  )
}
