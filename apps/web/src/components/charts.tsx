'use client';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '@/i18n';
import { fmtNum } from '@/lib/format';

/**
 * Single-series magnitude bars in the validated chart hue (one series → no legend; the title names it).
 * Rounded data-ends, thin bars with surface gaps, recessive grid, hover tooltip, and a screen-reader table.
 */
export function Bars({ data, horizontal, height = 220, unit = '', valueLabel }: { data: { label: string; value: number }[]; horizontal?: boolean; height?: number; unit?: string; valueLabel: string }) {
  const { locale, dir } = useI18n();
  const tick = { fill: 'rgb(var(--muted))', fontSize: 12 };
  const fmt = (v: number) => `${fmtNum(v, locale, unit === '%' ? 0 : 0)}${unit}`;
  return (
    <figure>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 16, right: 40, bottom: 0, left: 0 }} barCategoryGap={horizontal ? 6 : '28%'}>
            <CartesianGrid stroke="rgb(var(--line))" strokeDasharray="0" horizontal={!horizontal} vertical={!!horizontal} />
            {/* Recharts only discovers axes that are direct children — no fragments here. */}
            <XAxis
              type={horizontal ? 'number' : 'category'}
              dataKey={horizontal ? undefined : 'label'}
              tick={tick}
              axisLine={horizontal ? false : { stroke: 'rgb(var(--line))' }}
              tickLine={false}
              reversed={dir === 'rtl'}
              allowDecimals={false}
              interval={0}
            />
            <YAxis
              type={horizontal ? 'category' : 'number'}
              dataKey={horizontal ? 'label' : undefined}
              tick={tick}
              width={horizontal ? 160 : 36}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              interval={0}
              orientation={dir === 'rtl' ? 'right' : 'left'}
            />
            <Tooltip
              cursor={{ fill: 'rgb(var(--ink) / 0.04)' }}
              contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 6, fontSize: 13, color: 'rgb(var(--ink))' }}
              formatter={(v: number) => [fmt(v), valueLabel]}
            />
            <Bar dataKey="value" fill="rgb(var(--chart))" radius={horizontal ? (dir === 'rtl' ? [4, 0, 0, 4] : [0, 4, 4, 0]) : [4, 4, 0, 0]} maxBarSize={horizontal ? 18 : 36} isAnimationActive={false}>
              <LabelList dataKey="value" position={horizontal ? (dir === 'rtl' ? 'left' : 'right') : 'top'} formatter={(v: number) => (v ? fmt(v) : '')} style={{ fill: 'rgb(var(--ink))', fontSize: 12 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <tbody>{data.map((d) => <tr key={d.label}><th>{d.label}</th><td>{fmt(d.value)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
