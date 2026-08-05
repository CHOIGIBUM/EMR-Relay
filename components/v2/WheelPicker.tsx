"use client";

import { useEffect, useMemo, useRef } from "react";
import styles from "./V2.module.css";

export default function WheelPicker({ label, value, min, max, step = 1, unit, onChange }: {
  label: string;
  value?: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange(value: number): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const values = useMemo(() => {
    const items: number[] = [];
    for (let item = min; item <= max; item += step) items.push(item);
    return items;
  }, [max, min, step]);

  useEffect(() => {
    if (!ref.current) return;
    const valueIndex = value === undefined ? -1 : values.indexOf(value);
    const index = valueIndex < 0 ? 0 : valueIndex + 1;
    ref.current.scrollTo({ top: index * 42, behavior: "instant" });
  }, [value, values]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const commitScroll = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!ref.current) return;
      const index = Math.max(0, Math.min(values.length, Math.round(ref.current.scrollTop / 42)));
      ref.current.scrollTo({ top: index * 42, behavior: "smooth" });
      const selected = index === 0 ? undefined : values[index - 1];
      if (selected !== undefined && selected !== value) onChange(selected);
    }, 80);
  };

  return (
    <label className={styles.wheelPicker}>
      <span>{label}</span>
      <div className={styles.wheelWindow} data-unset={value === undefined}>
        <div className={styles.wheelHighlight} />
        <div ref={ref} className={styles.wheelScroll} onScroll={commitScroll} tabIndex={0} role="listbox" aria-label={label}>
          <i aria-hidden="true" />
          <button type="button" className={styles.wheelUnset} role="option" aria-selected={value === undefined}>미입력</button>
          {values.map((item) => <button type="button" role="option" aria-selected={item === value} key={item} onClick={() => onChange(item)}>{item}</button>)}
          <i aria-hidden="true" />
        </div>
        <small>{unit}</small>
      </div>
    </label>
  );
}
