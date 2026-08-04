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
    if (value === undefined || !ref.current) return;
    const index = Math.max(0, values.indexOf(value));
    ref.current.scrollTo({ top: index * 42, behavior: "instant" });
  }, [value, values]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const commitScroll = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!ref.current) return;
      const index = Math.max(0, Math.min(values.length - 1, Math.round(ref.current.scrollTop / 42)));
      ref.current.scrollTo({ top: index * 42, behavior: "smooth" });
      if (values[index] !== value) onChange(values[index]);
    }, 80);
  };

  return (
    <label className={styles.wheelPicker}>
      <span>{label}</span>
      <div className={styles.wheelWindow}>
        <div className={styles.wheelHighlight} />
        <div ref={ref} className={styles.wheelScroll} onScroll={commitScroll} tabIndex={0} role="listbox" aria-label={label}>
          <i aria-hidden="true" />
          {values.map((item) => <button type="button" role="option" aria-selected={item === value} key={item} onClick={() => onChange(item)}>{item}</button>)}
          <i aria-hidden="true" />
        </div>
        <small>{unit}</small>
      </div>
    </label>
  );
}
