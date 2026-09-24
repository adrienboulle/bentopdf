import { createIcons, icons } from 'lucide';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import {
  DestinationProvider,
  DEFAULT_FIELD_NAME,
  isSupportedUrl,
  type Destination,
  type DestinationDraft,
  type DestinationMethod,
  type DestinationMode,
} from '../utils/destination-provider.js';
import { sendToDestination } from '../utils/destination-sender.js';
import { initI18n, t } from '../i18n/index.js';

const TEST_FILENAME = 'bentopdf-destination-test.pdf';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePage);
} else {
  initializePage();
}

async function initializePage() {
  createIcons({ icons });

  try {
    await initI18n();
  } catch (error) {
    console.warn('Destination settings i18n initialization failed:', error);
  }

  const activeSelect = document.getElementById(
    'active-destination'
  ) as HTMLSelectElement;
  const defaultActionSelect = document.getElementById(
    'default-action'
  ) as HTMLSelectElement;
  const list = document.getElementById('destination-list') as HTMLDivElement;
  const emptyMessage = document.getElementById(
    'destination-empty'
  ) as HTMLParagraphElement;
  const addBtn = document.getElementById(
    'add-destination'
  ) as HTMLButtonElement;
  const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
  const backBtn = document.getElementById('back-to-tools');

  const editor = document.getElementById(
    'destination-editor'
  ) as HTMLDivElement;
  const editorTitle = document.getElementById(
    'editor-title'
  ) as HTMLHeadingElement;
  const nameInput = document.getElementById(
    'destination-name'
  ) as HTMLInputElement;
  const urlInput = document.getElementById(
    'destination-url'
  ) as HTMLInputElement;
  const methodSelect = document.getElementById(
    'destination-method'
  ) as HTMLSelectElement;
  const fieldNameRow = document.getElementById(
    'field-name-row'
  ) as HTMLDivElement;
  const fieldNameInput = document.getElementById(
    'destination-field-name'
  ) as HTMLInputElement;
  const modeSelect = document.getElementById(
    'destination-mode'
  ) as HTMLSelectElement;
  const headersList = document.getElementById('headers-list') as HTMLDivElement;
  const addHeaderBtn = document.getElementById(
    'add-header'
  ) as HTMLButtonElement;
  const extraFieldsRow = document.getElementById(
    'extra-fields-row'
  ) as HTMLDivElement;
  const extraFieldsList = document.getElementById(
    'extra-fields-list'
  ) as HTMLDivElement;
  const addExtraFieldBtn = document.getElementById(
    'add-extra-field'
  ) as HTMLButtonElement;
  const saveBtn = document.getElementById(
    'save-destination'
  ) as HTMLButtonElement;
  const testBtn = document.getElementById(
    'test-destination'
  ) as HTMLButtonElement;
  const cancelBtn = document.getElementById(
    'cancel-destination'
  ) as HTMLButtonElement;

  let editingId: string | null = null;

  backBtn?.addEventListener('click', () => {
    window.location.href = import.meta.env.BASE_URL;
  });

  function modeLabel(mode: DestinationMode): string {
    return t(`tools:destinationSettings.mode.${mode}`);
  }

  function addPairRow(
    container: HTMLElement,
    name = '',
    value = '',
    namePlaceholder = '',
    valuePlaceholder = ''
  ): void {
    const row = document.createElement('div');
    row.className = 'flex gap-2 items-center';
    row.dataset.pairRow = 'true';

    const nameField = document.createElement('input');
    nameField.type = 'text';
    nameField.value = name;
    nameField.placeholder = namePlaceholder;
    nameField.dataset.pairName = 'true';
    nameField.className =
      'flex-1 bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5 text-sm';

    const valueField = document.createElement('input');
    valueField.type = 'text';
    valueField.value = value;
    valueField.placeholder = valuePlaceholder;
    valueField.dataset.pairValue = 'true';
    valueField.className =
      'flex-1 bg-gray-700 border border-gray-600 text-white rounded-lg p-2.5 text-sm';

    const removeBtn = document.createElement('button');
    removeBtn.className =
      'p-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg border border-red-600/50 transition-colors';
    removeBtn.title = t('common.remove');
    const removeIcon = document.createElement('i');
    removeIcon.setAttribute('data-lucide', 'trash-2');
    removeIcon.className = 'w-4 h-4';
    removeBtn.append(removeIcon);
    removeBtn.addEventListener('click', () => row.remove());

    row.append(nameField, valueField, removeBtn);
    container.append(row);
    createIcons({ icons });
  }

  function readPairRows(container: HTMLElement): {
    name: string;
    value: string;
  }[] {
    const pairs: { name: string; value: string }[] = [];
    container.querySelectorAll('[data-pair-row]').forEach((row) => {
      const nameField = row.querySelector(
        '[data-pair-name]'
      ) as HTMLInputElement | null;
      const valueField = row.querySelector(
        '[data-pair-value]'
      ) as HTMLInputElement | null;
      const name = nameField?.value.trim() ?? '';
      if (!name) return;
      pairs.push({ name, value: valueField?.value ?? '' });
    });
    return pairs;
  }

  function updateMethodVisibility(): void {
    const isPost = methodSelect.value === 'POST';
    fieldNameRow.classList.toggle('hidden', !isPost);
    extraFieldsRow.classList.toggle('hidden', !isPost);
  }

  function renderDestinationRow(destination: Destination): HTMLDivElement {
    const row = document.createElement('div');
    row.className =
      'bg-gray-700/50 rounded-lg p-4 border border-gray-600 flex items-start justify-between gap-3';

    const info = document.createElement('div');
    info.className = 'min-w-0';

    const title = document.createElement('p');
    title.className = 'font-semibold text-white truncate';
    title.textContent = destination.name;

    const details = document.createElement('p');
    details.className = 'text-xs text-gray-400 truncate';
    details.textContent = `${destination.method} ${destination.url}`;

    const mode = document.createElement('p');
    mode.className = 'text-xs text-gray-500 mt-1';
    mode.textContent = modeLabel(
      DestinationProvider.getEffectiveMode(destination)
    );

    info.append(title, details, mode);

    const actions = document.createElement('div');
    actions.className = 'flex gap-2 flex-shrink-0';

    const editBtn = document.createElement('button');
    editBtn.className =
      'px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-xs font-medium transition-colors';
    editBtn.textContent = t('common.edit');
    editBtn.addEventListener('click', () => openEditor(destination));

    const deleteBtn = document.createElement('button');
    deleteBtn.className =
      'px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-xs font-medium border border-red-600/50 transition-colors';
    deleteBtn.textContent = t('common.delete');
    deleteBtn.addEventListener('click', () => {
      DestinationProvider.remove(destination.id);
      if (editingId === destination.id) closeEditor();
      renderAll();
    });

    actions.append(editBtn, deleteBtn);
    row.append(info, actions);
    return row;
  }

  function renderAll(): void {
    const destinations = DestinationProvider.getAll();

    list.replaceChildren(...destinations.map(renderDestinationRow));
    emptyMessage.classList.toggle('hidden', destinations.length > 0);

    const activeId = DestinationProvider.getActiveId();
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = t('tools:destinationSettings.activeNone');
    activeSelect.replaceChildren(
      noneOption,
      ...destinations.map((destination) => {
        const option = document.createElement('option');
        option.value = destination.id;
        option.textContent = destination.name;
        return option;
      })
    );
    activeSelect.value = activeId ?? '';

    defaultActionSelect.value = DestinationProvider.getDefaultAction();
  }

  function openEditor(destination?: Destination): void {
    editingId = destination?.id ?? null;
    editorTitle.textContent = destination
      ? t('tools:destinationSettings.editorTitleEdit', {
          name: destination.name,
        })
      : t('tools:destinationSettings.editorTitle');

    nameInput.value = destination?.name ?? '';
    urlInput.value = destination?.url ?? '';
    methodSelect.value = destination?.method ?? 'POST';
    fieldNameInput.value = destination?.fieldName ?? DEFAULT_FIELD_NAME;
    modeSelect.value =
      destination?.mode ?? DestinationProvider.getDefaultAction();

    headersList.replaceChildren();
    for (const header of destination?.headers ?? []) {
      addPairRow(headersList, header.name, header.value);
    }

    extraFieldsList.replaceChildren();
    for (const field of destination?.extraFields ?? []) {
      addPairRow(extraFieldsList, field.name, field.value);
    }

    updateMethodVisibility();
    editor.classList.remove('hidden');
  }

  function closeEditor(): void {
    editingId = null;
    editor.classList.add('hidden');
  }

  function readDraft(): DestinationDraft | null {
    const url = urlInput.value.trim();
    if (!isSupportedUrl(url)) {
      showAlert(
        t('tools:destinationSettings.invalidUrlTitle'),
        t('tools:destinationSettings.invalidUrlMessage')
      );
      return null;
    }

    return {
      id: editingId ?? undefined,
      name: nameInput.value.trim() || url,
      url,
      method: methodSelect.value as DestinationMethod,
      fieldName: fieldNameInput.value.trim() || DEFAULT_FIELD_NAME,
      headers: readPairRows(headersList),
      extraFields: readPairRows(extraFieldsList),
      mode: modeSelect.value as DestinationMode,
    };
  }

  /**
   * The test sends a real one-page PDF, not an empty placeholder: a document
   * manager would reject a zero-byte upload, so a rejected test would tell
   * nothing about the configuration. The destination therefore receives a
   * document that has to be deleted afterwards.
   */
  async function buildTestPdf(): Promise<Blob> {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(t('tools:destinationSettings.testDocumentText'), {
      x: 56,
      y: 760,
      size: 14,
      font,
    });
    const bytes = await pdf.save();
    return new Blob([bytes.buffer as ArrayBuffer], {
      type: 'application/pdf',
    });
  }

  addHeaderBtn?.addEventListener('click', () => {
    addPairRow(headersList, '', '', 'Authorization', 'Token abcdef123456');
  });

  addExtraFieldBtn?.addEventListener('click', () => {
    // The value placeholder shows a template on purpose: the help text below
    // the list explains what it resolves to.
    addPairRow(extraFieldsList, '', '', 'title', '{{basename}}');
  });

  methodSelect?.addEventListener('change', updateMethodVisibility);

  addBtn?.addEventListener('click', () => openEditor());

  cancelBtn?.addEventListener('click', closeEditor);

  saveBtn?.addEventListener('click', () => {
    const draft = readDraft();
    if (!draft) return;

    try {
      const saved = DestinationProvider.save(draft);
      if (!DestinationProvider.getActiveId()) {
        DestinationProvider.setActiveId(saved.id);
      }
      closeEditor();
      renderAll();
      showAlert(
        t('tools:destinationSettings.savedTitle'),
        t('tools:destinationSettings.savedMessage'),
        'success'
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t('common.unknownError');
      showAlert(
        t('tools:destinationSettings.errorTitle'),
        t('tools:destinationSettings.failedSave', { message })
      );
    }
  });

  testBtn?.addEventListener('click', async () => {
    const draft = readDraft();
    if (!draft) return;

    showLoader(t('tools:destinationSettings.testing'));
    try {
      const blob = await buildTestPdf();
      await sendToDestination(blob, TEST_FILENAME, {
        ...draft,
        id: draft.id ?? 'test',
      });
      hideLoader();
      showAlert(
        t('tools:destinationSettings.testSuccessTitle'),
        t('tools:destinationSettings.testSuccessMessage', {
          filename: TEST_FILENAME,
        }),
        'success'
      );
    } catch (e: unknown) {
      hideLoader();
      const message = e instanceof Error ? e.message : t('common.unknownError');
      showAlert(
        t('tools:destinationSettings.testFailedTitle'),
        t('tools:destinationSettings.testFailedMessage', { message })
      );
    }
  });

  activeSelect?.addEventListener('change', () => {
    DestinationProvider.setActiveId(activeSelect.value || null);
  });

  defaultActionSelect?.addEventListener('change', () => {
    DestinationProvider.setDefaultAction(
      defaultActionSelect.value as DestinationMode
    );
  });

  clearBtn?.addEventListener('click', () => {
    DestinationProvider.clearAll();
    closeEditor();
    renderAll();
    showAlert(
      t('tools:destinationSettings.clearedTitle'),
      t('tools:destinationSettings.clearedMessage'),
      'success'
    );
  });

  renderAll();
}
