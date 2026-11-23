import { useEffect, useRef } from 'react';
import { edgeKindLabels } from '../core/model';
import type { WalkthroughStep } from '../core/walkthrough';

export interface WalkthroughVisibility {
  /** 現在の表示で接続が描かれているか。 */
  visible: boolean;
  /** 折りたたみを開けば表示できるか。 */
  revealable: boolean;
}

/**
 * 処理の流れを1ステップずつ説明するパネル。
 * 画面の位置は利用者が「画面に表示」を押したときだけ動かす。
 */
export function WalkthroughPanel({
  steps,
  index,
  playing,
  reducedMotion,
  visibility,
  onToggle,
  onMove,
  onEnd,
  onReveal,
  onShow,
}: {
  steps: WalkthroughStep[];
  index: number;
  playing: boolean;
  reducedMotion: boolean;
  visibility: WalkthroughVisibility;
  onToggle: () => void;
  onMove: (index: number) => void;
  onEnd: () => void;
  onReveal: () => void;
  onShow: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    // 開始時にパネルへ移動し、矢印キー・Esc をすぐ使えるようにする。
    panel.current?.focus();
  }, []);
  const step = steps[index]!;
  const explicitCount = steps.filter((item) => item.basis === 'explicit').length;
  const routeLabel = step.route
    ? `経路 ${step.route.name}・${step.route.direction === 'return' ? '復路' : '往路'} ${step.route.step}`
    : `${edgeKindLabels[step.kind]}（順序の指定なし）`;
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="walkthrough-panel"
      aria-label="処理の流れの説明"
      data-playing={playing}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
        if (event.key === 'Escape') onEnd();
        else if (event.key === 'ArrowRight') onMove(Math.min(steps.length - 1, index + 1));
        else if (event.key === 'ArrowLeft') onMove(Math.max(0, index - 1));
        else if (
          event.key === ' ' &&
          !(event.target instanceof Element && event.target.closest('button, select'))
        )
          onToggle();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <header className="walkthrough-header">
        <span className="walkthrough-badge" aria-hidden="true">
          {index + 1}
        </span>
        <div>
          <strong>処理の流れ</strong>
          <span>
            ステップ {index + 1} / {steps.length}
          </span>
        </div>
        <button
          type="button"
          className="walkthrough-close"
          aria-label="説明を終了"
          title="説明を終了（Esc）"
          onClick={onEnd}
        >
          ×
        </button>
      </header>
      <div className="walkthrough-track" aria-hidden="true">
        <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
      </div>
      <div className="walkthrough-body" aria-live="polite" aria-atomic="true">
        <p className="walkthrough-route" data-basis={step.basis}>
          {routeLabel}
        </p>
        <h3>{step.title}</h3>
        <p className="walkthrough-description">{step.description}</p>
      </div>
      {!visibility.visible && (
        <p className="walkthrough-hidden" role="status">
          この接続は現在の表示（折りたたみ・表示オプション）では描かれていません。
          {visibility.revealable && (
            <button type="button" className="toolbar-button" onClick={onReveal}>
              折りたたみを開いて表示
            </button>
          )}
        </p>
      )}
      <div className="walkthrough-controls" role="group" aria-label="説明の操作">
        <button
          type="button"
          className="toolbar-button"
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
          title="前のステップ（←）"
        >
          ← 前へ
        </button>
        <button
          type="button"
          className="toolbar-button walkthrough-play"
          aria-pressed={playing}
          disabled={reducedMotion}
          onClick={onToggle}
          title={playing ? '一時停止（Space）' : '再生（Space）'}
        >
          {playing ? '❚❚ 一時停止' : '▶ 再生'}
        </button>
        <button
          type="button"
          className="toolbar-button"
          disabled={index === steps.length - 1}
          onClick={() => onMove(index + 1)}
          title="次のステップ（→）"
        >
          次へ →
        </button>
        <button
          type="button"
          className="toolbar-button"
          disabled={!visibility.visible}
          onClick={onShow}
          title="この接続の両端が見える位置へ画面を動かします"
        >
          画面に表示
        </button>
      </div>
      <label className="walkthrough-jump">
        ステップへ移動
        <select
          aria-label="ステップへ移動"
          value={index}
          onChange={(event) => onMove(Number(event.target.value))}
        >
          {steps.map((item, position) => (
            <option key={item.connectionId} value={position}>
              {position + 1}. {item.title}
            </option>
          ))}
        </select>
      </label>
      <p className="walkthrough-basis">
        {reducedMotion && '動きを抑える設定のため、前へ・次へで進められます。'}
        {step.basis === 'explicit'
          ? '図に記録された設計上の順序です。'
          : explicitCount
            ? '明示した経路の後に、順序の指定がない接続を種類とつながりから並べています。'
            : '順序の指定がないため、接続の種類とつながりから並べた説明です。'}
        実際の通信や実行順を観測したものではありません。
      </p>
    </section>
  );
}
