import { render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { RecursivePanel } from '../PanelComponents';
import { ToastProvider } from '../../../contexts/ToastContext';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

const invokeMock = vi.mocked(invoke);

// Shape of a Bench test panel (demo.ini `testSpark`): command buttons only.
const SPARK_PANEL = {
  name: 'testSpark',
  title: 'Spark',
  components: [
    { type: 'CommandButton', label: 'Spark #1', command: 'cmd_test_spk1' },
    { type: 'CommandButton', label: 'Spark #2', command: 'cmd_test_spk2' },
    { type: 'CommandButton', label: 'Spark #3', command: 'cmd_test_spk3' },
    { type: 'CommandButton', label: 'Abort test', command: 'cmd_test_cancel' },
  ],
};

describe('command-only panels (Bench test grids)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string, args?: unknown) => {
      switch (cmd) {
        case 'get_indicator_panel':
        case 'get_readout_panel':
          return Promise.reject(new Error(`not a ${cmd}`));
        case 'get_dialog_definition':
          return Promise.resolve(SPARK_PANEL);
        case 'evaluate_string_expression':
          return Promise.resolve((args as { expression: string }).expression);
        default:
          return Promise.resolve(undefined);
      }
    });
  });

  // The stylesheet relies on this structure: the button row must be a direct child
  // of the two-column command grid (`.panel-content--command-grid > .command-button-row`
  // is `display: contents`). If grouping changes, the Bench test layout breaks again.
  it('keeps the command-button row as a direct child of the command grid', async () => {
    const { container } = render(
      <ToastProvider>
        <RecursivePanel name="testSpark" openTable={() => {}} context={{}} />
      </ToastProvider>,
    );

    await screen.findByText('Spark #1');

    const grid = container.querySelector('.panel-content--command-grid');
    expect(grid).not.toBeNull();
    const rows = Array.from(grid!.children).filter((el) =>
      el.classList.contains('command-button-row'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll('.command-button')).toHaveLength(4);
  });
});
