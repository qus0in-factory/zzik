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
