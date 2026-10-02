<script lang="ts">
  /** Animated "agent is thinking" mark (owner's ai-thinking-order.svg): eight dots drift and slowly rotate. */
  const LIGHT = '#C4DCFF';
  const ACCENT = '#5EA2FF';
  const KEY_TIMES = '0;.25;.5;.75;1';
  const SPLINES = '.35 .1 .65 .9;.35 .1 .65 .9;.35 .1 .65 .9;.35 .1 .65 .9';

  const dots: { fill: string; cx: number[]; cy: number[] }[] = [
    { fill: LIGHT, cx: [10.701, 15, 7.372, 20.081], cy: [5.973, 6, 15.565, 12.895] },
    { fill: ACCENT, cx: [5.043, 21.364, 10.288, 20.081], cy: [7.873, 8.636, 11.978, 17.105] },
    { fill: ACCENT, cx: [10.506, 24, 16.068, 17.105], cy: [7.003, 15, 23.804, 20.081] },
    { fill: ACCENT, cx: [18.837, 21.364, 21.545, 12.895], cy: [18.202, 21.364, 21.939, 20.081] },
    { fill: LIGHT, cx: [20.406, 15, 7.026, 9.919], cy: [11.058, 24, 18.221, 17.105] },
    { fill: ACCENT, cx: [5.434, 8.636, 13.868, 9.919], cy: [22.862, 21.364, 6.399, 12.895] },
    { fill: ACCENT, cx: [14.71, 6, 21.379, 12.895], cy: [15.61, 15, 24.152, 9.919] },
    { fill: ACCENT, cx: [18.058, 8.636, 23.791, 17.105], cy: [22.443, 8.636, 17.126, 9.919] },
  ];

  /** A closed loop: the path returns to its first point. */
  const loop = (v: number[]): string => [...v, v[0]].join(';');
</script>

<svg
  class="fd-thinking"
  xmlns="http://www.w3.org/2000/svg"
  width="15"
  height="15"
  viewBox="0 0 30 30"
  fill="none"
  aria-hidden="true"
>
  <g>
    <animateTransform
      attributeName="transform"
      type="rotate"
      from="0 15 15"
      to="360 15 15"
      dur="9.6s"
      repeatCount="indefinite"
    />
    {#each dots as dot}
      <circle cx={dot.cx[0]} cy={dot.cy[0]} r="1.25" fill={dot.fill} opacity=".5">
        {#each [['cx', loop(dot.cx)], ['cy', loop(dot.cy)], ['opacity', '.5;1;.5;1;.5'], ['r', '1.25;1.6;1.25;1.35;1.25']] as [attributeName, values]}
          <animate
            {attributeName}
            {values}
            dur="4.8s"
            repeatCount="indefinite"
            keyTimes={KEY_TIMES}
            calcMode="spline"
            keySplines={SPLINES}
          />
        {/each}
      </circle>
    {/each}
  </g>
</svg>

<style>
  .fd-thinking {
    flex: none;
    display: block;
  }
</style>
