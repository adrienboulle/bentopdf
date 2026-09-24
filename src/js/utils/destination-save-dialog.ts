import { t } from '../i18n/index.js';
import type { DestinationMode } from './destination-provider.js';

/** What the user can pick in the Save dialog: everything but `ask` itself. */
export type DestinationSaveAction = Exclude<DestinationMode, 'ask'>;

export interface DestinationSaveRequest {
  /** Name the tool produced, used as the prefilled value. */
  filename: string;
  /** Label of the active destination, shown on the "send" choice. */
  destinationName: string;
}

export interface DestinationSaveChoice {
  /** Name the user confirmed, extension included. */
  filename: string;
  action: DestinationSaveAction;
}

const DIALOG_ID = 'destination-save-dialog';
const CHOICE_KEY = 'bentopdf:destination-save-choice';
const ACTIONS: DestinationSaveAction[] = ['download', 'send', 'both'];
const FALLBACK_ACTION: DestinationSaveAction = 'both';

/**
 * Splits a produced filename into the part the user may rewrite and the
 * extension, which is kept whatever is typed: a result renamed `invoice`
 * still has to be saved and sent as `invoice.pdf`.
 */
export function splitFilename(filename: string): {
  base: string;
  extension: string;
} {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) {
    return { base: filename, extension: '' };
  }
  return { base: filename.slice(0, dot), extension: filename.slice(dot) };
}

/**
 * Applies what the user typed to the produced filename: path separators are
 * replaced, an empty value falls back to the original name, and the original
 * extension is appended when it was removed.
 */
function applyTypedName(
  typed: string,
  extension: string,
  fallback: string
): string {
  const cleaned = typed.replace(/[\\/]+/g, '-').trim();
  if (!cleaned || cleaned === extension) return fallback;
  if (!extension) return cleaned;
  return cleaned.toLowerCase().endsWith(extension.toLowerCase())
    ? cleaned
    : `${cleaned}${extension}`;
}

function readLastAction(): DestinationSaveAction {
  try {
    const stored = localStorage.getItem(CHOICE_KEY);
    if (ACTIONS.includes(stored as DestinationSaveAction)) {
      return stored as DestinationSaveAction;
    }
  } catch (e) {
    console.warn('[Destinations] Failed to read the last save choice:', e);
  }
  return FALLBACK_ACTION;
}

function rememberAction(action: DestinationSaveAction): void {
  try {
    localStorage.setItem(CHOICE_KEY, action);
  } catch (e) {
    console.warn('[Destinations] Failed to save the last save choice:', e);
  }
}

function actionLabel(
  action: DestinationSaveAction,
  destinationName: string
): string {
  if (action === 'send') {
    return t('tools:destinationSettings.saveDialog.send', {
      name: destinationName,
    });
  }
  return t(`tools:destinationSettings.saveDialog.${action}`);
}

function buildDialog(
  request: DestinationSaveRequest,
  resolve: (choice: DestinationSaveChoice | null) => void
): void {
  const { base, extension } = splitFilename(request.filename);

  const overlay = document.createElement('div');
  overlay.id = DIALOG_ID;
  // Above #alert-modal (z-50): tools open their own "Success" modal right
  // after downloadFile, and the question has to stay on top of it.
  overlay.className =
    'fixed inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center z-[60] p-4';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);

  const card = document.createElement('div');
  card.className =
    'bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm w-full border border-gray-700';

  const title = document.createElement('h3');
  title.id = `${DIALOG_ID}-title`;
  title.className = 'text-xl font-bold text-white mb-4';
  title.textContent = t('tools:destinationSettings.saveDialog.title');

  const nameLabel = document.createElement('label');
  nameLabel.htmlFor = `${DIALOG_ID}-filename`;
  nameLabel.className = 'block text-sm font-medium text-gray-300 mb-1';
  nameLabel.textContent = t(
    'tools:destinationSettings.saveDialog.filenameLabel'
  );

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = `${DIALOG_ID}-filename`;
  nameInput.value = request.filename;
  nameInput.className =
    'w-full bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5 text-sm';

  card.append(title, nameLabel, nameInput);

  if (extension) {
    const hint = document.createElement('p');
    hint.className = 'text-xs text-gray-500 mt-1';
    hint.textContent = t('tools:destinationSettings.saveDialog.extensionHint', {
      extension,
    });
    card.append(hint);
  }

  const choices = document.createElement('fieldset');
  choices.className = 'mt-4';

  const legend = document.createElement('legend');
  legend.className = 'text-sm font-medium text-gray-300 mb-2';
  legend.textContent = t('tools:destinationSettings.saveDialog.actionLabel');
  choices.append(legend);

  const lastAction = readLastAction();
  for (const action of ACTIONS) {
    const row = document.createElement('label');
    row.className =
      'flex items-center gap-2 text-sm text-gray-300 py-1 cursor-pointer';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `${DIALOG_ID}-action`;
    radio.value = action;
    radio.checked = action === lastAction;
    radio.className = 'accent-indigo-500';

    const text = document.createElement('span');
    text.textContent = actionLabel(action, request.destinationName);

    row.append(radio, text);
    choices.append(row);
  }

  const actions = document.createElement('div');
  actions.className = 'flex gap-3 mt-6';

  const confirmBtn = document.createElement('button');
  confirmBtn.id = `${DIALOG_ID}-confirm`;
  confirmBtn.className =
    'flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200';
  confirmBtn.textContent = t('common.save');

  const cancelBtn = document.createElement('button');
  cancelBtn.id = `${DIALOG_ID}-cancel`;
  cancelBtn.className =
    'flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold py-2 px-4 rounded-lg transition-colors duration-200';
  cancelBtn.textContent = t('common.cancel');

  actions.append(confirmBtn, cancelBtn);
  card.append(choices, actions);
  overlay.append(card);

  let settled = false;

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close(null);
  };

  function close(choice: DestinationSaveChoice | null): void {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    resolve(choice);
  }

  function confirmChoice(): void {
    const selected = overlay.querySelector(
      `input[name="${DIALOG_ID}-action"]:checked`
    ) as HTMLInputElement | null;
    const action = ACTIONS.includes(selected?.value as DestinationSaveAction)
      ? (selected?.value as DestinationSaveAction)
      : FALLBACK_ACTION;
    rememberAction(action);
    close({
      filename: applyTypedName(nameInput.value, extension, request.filename),
      action,
    });
  }

  confirmBtn.addEventListener('click', confirmChoice);
  cancelBtn.addEventListener('click', () => close(null));
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmChoice();
    }
  });
  document.addEventListener('keydown', onKeydown);

  document.body.append(overlay);
  nameInput.focus();
  nameInput.setSelectionRange(0, base.length);
}

/**
 * Tools can produce several files in a row, and every one of them goes through
 * `downloadFile`: dialogs are queued so they are answered one at a time
 * instead of stacking on top of each other.
 */
let pending: Promise<unknown> | null = null;

/**
 * Asks what to do with a produced file: download it, send it to the active
 * destination, or both, and under which name. Resolves with null when the
 * user cancels, in which case nothing is downloaded and nothing is sent.
 */
export function askDestinationSave(
  request: DestinationSaveRequest
): Promise<DestinationSaveChoice | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);

  const open = (): Promise<DestinationSaveChoice | null> =>
    new Promise((resolve) => buildDialog(request, resolve));

  const answer = pending ? pending.then(open, open) : open();

  // The queue is empty again once the last dialog asked has been answered.
  const settle = (): void => {
    if (pending === tail) pending = null;
  };
  const tail: Promise<void> = answer.then(settle, settle);
  pending = tail;

  return answer;
}
