import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  asksRuntime,
  asksStorage,
  cloudOptions,
  defaultBlueprintAnswers,
  deliveryOptions,
  describeAnswers,
  generateBlueprint,
  normalizeBlueprintAnswers,
  purposeOptions,
  regionOptions,
  runtimeOptions,
  storageOptions,
  type Blueprint,
  type BlueprintAnswers,
  type BlueprintOption,
  type BlueprintPurpose,
  type BlueprintStorage,
} from '../core/blueprint';
import { buildWalkthrough } from '../core/walkthrough';

type Question = 'purpose' | 'cloud' | 'region' | 'runtime' | 'storage' | 'delivery' | 'summary';
const questionTitles: Record<Question, string> = {
  purpose: '何を作る予定ですか？',
  cloud: 'どのクラウドで作りますか？',
  region: 'どこで動かしますか？',
  runtime: '処理をどう動かしますか？',
  storage: 'データを保存しますか？',
  delivery: '配備の流れも描きますか？',
  summary: 'この内容で雛形を作ります',
};
const questionHints: Partial<Record<Question, string>> = {
  storage: '複数選べます。何も選ばない場合は「保存しない」として描きます。',
  summary: '回答はあとから「変更」で直せます。作成後も DSL・属性の編集と「元に戻す」が使えます。',
};

function Choices<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: BlueprintOption<T>[];
  value?: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="wizard-choices" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <label key={option.value} className="wizard-choice">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * 短い質問を順に答えて、設計用の雛形を作るダイアログ。
 * 生成は決定的な規則だけで行い、通信や外部サービスを使わない。
 */
export function CreateWizard({
  blocked,
  replacing,
  onCancel,
  onCreate,
}: {
  /** 作成できない理由（未反映の DSL 下書きなど）。 */
  blocked?: string;
  /** 現在の図を置き換えるか。 */
  replacing: boolean;
  onCancel: () => void;
  onCreate: (blueprint: Blueprint) => void;
}) {
  const titleId = useId();
  const [purpose, setPurpose] = useState<BlueprintPurpose>();
  const [answers, setAnswers] = useState(defaultBlueprintAnswers);
  const [position, setPosition] = useState(0);
  const [returnToSummary, setReturnToSummary] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const questions: Question[] = [
    'purpose',
    'cloud',
    'region',
    ...(!purpose || asksRuntime(purpose) ? (['runtime'] as const) : []),
    ...(!purpose || asksStorage(purpose) ? (['storage'] as const) : []),
    'delivery',
    'summary',
  ];
  const question = questions[Math.min(position, questions.length - 1)]!;
  const complete: BlueprintAnswers | undefined = purpose
    ? normalizeBlueprintAnswers({ ...answers, purpose })
    : undefined;
  const preview = useMemo(() => {
    if (!complete || question !== 'summary') return undefined;
    try {
      return { blueprint: generateBlueprint(complete) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    // complete は answers と purpose から作るため、元の値で更新を判定する。
  }, [answers, purpose, question]);
  useEffect(() => {
    heading.current?.focus();
  }, [question]);
  const go = (next: Question) => setPosition(questions.indexOf(next));
  const advance = () => {
    if (question === 'purpose' && !purpose) return;
    if (returnToSummary && question !== 'summary') {
      setReturnToSummary(false);
      go('summary');
      return;
    }
    setPosition((current) => Math.min(questions.length - 1, current + 1));
  };
  const back = () => {
    setReturnToSummary(false);
    setPosition((current) => Math.max(0, current - 1));
  };
  const set = <K extends keyof typeof answers>(key: K, value: (typeof answers)[K]) =>
    setAnswers((current) => ({ ...current, [key]: value }));
  const toggleStorage = (item: BlueprintStorage, checked: boolean) =>
    setAnswers((current) => ({
      ...current,
      storage: checked
        ? [...new Set([...current.storage, item])]
        : current.storage.filter((value) => value !== item),
    }));

  let body: ReactNode;
  switch (question) {
    case 'purpose':
      body = (
        <Choices
          name="作るもの"
          options={purposeOptions}
          value={purpose}
          onChange={(value) => setPurpose(value)}
        />
      );
      break;
    case 'cloud':
      body = (
        <Choices
          name="クラウド"
          options={cloudOptions}
          value={answers.cloud}
          onChange={(value) => set('cloud', value)}
        />
      );
      break;
    case 'region':
      body = (
        <Choices
          name="リージョン"
          options={regionOptions(answers.cloud)}
          value={answers.region}
          onChange={(value) => set('region', value)}
        />
      );
      break;
    case 'runtime':
      body = (
        <Choices
          name="実行方式"
          options={runtimeOptions(answers.cloud)}
          value={complete?.runtime ?? answers.runtime}
          onChange={(value) => set('runtime', value)}
        />
      );
      break;
    case 'storage':
      body = (
        <div className="wizard-choices" role="group" aria-label="データの保存">
          {storageOptions(answers.cloud).map((option) => (
            <label key={option.value} className="wizard-choice">
              <input
                type="checkbox"
                checked={answers.storage.includes(option.value)}
                onChange={(event) => toggleStorage(option.value, event.target.checked)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
          <label className="wizard-choice">
            <input
              type="checkbox"
              checked={!answers.storage.length}
              onChange={(event) => {
                if (event.target.checked) set('storage', []);
              }}
            />
            <span>
              <strong>保存しない</strong>
              <small>状態を持たない処理として描きます。</small>
            </span>
          </label>
        </div>
      );
      break;
    case 'delivery':
      body = (
        <Choices
          name="配備の流れ"
          options={deliveryOptions}
          value={answers.delivery}
          onChange={(value) => set('delivery', value)}
        />
      );
      break;
    case 'summary': {
      const blueprint = preview?.blueprint;
      const editable: Record<string, Question> = {
        作るもの: 'purpose',
        クラウド: 'cloud',
        リージョン: 'region',
        実行方式: 'runtime',
        データの保存: 'storage',
        配備の流れ: 'delivery',
      };
      body = (
        <div className="wizard-summary">
          <dl className="wizard-answers">
            {complete &&
              describeAnswers(complete).map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                  <button
                    type="button"
                    className="wizard-edit"
                    aria-label={`${row.label}を変更`}
                    onClick={() => {
                      setReturnToSummary(true);
                      go(editable[row.label]!);
                    }}
                  >
                    変更
                  </button>
                </div>
              ))}
          </dl>
          {preview?.error && <p role="alert">{preview.error}</p>}
          {blueprint && (
            <>
              <section aria-label="作成する要素">
                <h3>作成する要素</h3>
                <ul className="wizard-chips">
                  {blueprint.diagram.resources
                    .filter((resource) => resource.type !== 'note')
                    .map((resource) => (
                      <li key={resource.id}>{resource.label}</li>
                    ))}
                </ul>
              </section>
              <section aria-label="処理の流れ">
                <h3>処理の流れ</h3>
                <ol className="wizard-flow">
                  {buildWalkthrough(blueprint.diagram).map((step) => (
                    <li key={step.connectionId}>{step.title}</li>
                  ))}
                </ol>
              </section>
              <section aria-label="設計上の仮定">
                <h3>設計上の仮定</h3>
                <ul>
                  {blueprint.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <details className="wizard-unresolved">
                <summary>作成後に確認が必要な事項（{blueprint.unresolved.length} 件）</summary>
                <ul>
                  {blueprint.unresolved.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
          <p className="wizard-notice">
            設計用の雛形です。クラウドへの構築や、通信・権限・費用の確認は行いません。
            {replacing && ' 作成すると現在の図を置き換えます。「元に戻す」で元の図に戻せます。'}
          </p>
          {blocked && (
            <p className="wizard-blocked" role="alert">
              {blocked}
            </p>
          )}
        </div>
      );
      break;
    }
  }
  const step = Math.min(position, questions.length - 1);
  return (
    <div
      className="wizard-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="create-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Tab') {
            // 質問中に背後の図へフォーカスが移り、誤って編集することを防ぐ。
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
              ),
            ].filter((element) => element.getClientRects().length > 0);
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (question !== 'summary') {
            advance();
            return;
          }
          if (preview?.blueprint && !blocked) onCreate(preview.blueprint);
        }}
      >
        <header className="wizard-header">
          <span className="wizard-kicker">新しく作る</span>
          <ol className="wizard-progress" aria-label={`質問 ${step + 1} / ${questions.length}`}>
            {questions.map((item, index) => (
              <li
                key={item}
                data-state={index < step ? 'done' : index === step ? 'current' : 'todo'}
                aria-current={index === step ? 'step' : undefined}
              >
                <span className="visually-hidden">{questionTitles[item]}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="wizard-close" aria-label="キャンセル" onClick={onCancel}>
            ×
          </button>
        </header>
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {questionTitles[question]}
        </h2>
        {questionHints[question] && <p className="wizard-hint">{questionHints[question]}</p>}
        <div className="wizard-body">{body}</div>
        <footer className="wizard-footer">
          <button type="button" className="toolbar-button" onClick={onCancel}>
            キャンセル
          </button>
          <span className="wizard-spacer" />
          <button type="button" className="toolbar-button" disabled={step === 0} onClick={back}>
            戻る
          </button>
          {question === 'summary' ? (
            <button
              type="submit"
              className="primary-button"
              disabled={!preview?.blueprint || Boolean(blocked)}
            >
              この内容で作成
            </button>
          ) : (
            <button
              type="submit"
              className="primary-button"
              disabled={question === 'purpose' && !purpose}
            >
              {returnToSummary ? '確認へ戻る' : '次へ'}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}
