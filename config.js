/**
 * @typedef {import('./src/keybindings').KeyBindingAction} KeyBindingAction
 */

/**
 * Keybindings configuration object that maps Neovim-style key sequences to actions.
 *
 * Keybinding Format:
 * - Single key: "a", "b", "1", etc.
 * - Special keys: "<Tab>", "<Enter>", etc.
 * - Modifiers:
 *   - <C-...> for Ctrl (e.g., <C-s> for Ctrl+S)
 *   - <A-...> for Alt
 *   - <S-...> for Shift
 *   - <M-...> for Meta/Command
 * - Multiple modifiers can be combined: <C-A-s> for Ctrl+Alt+S
 * - Multi-key sequences: <C-w>l for Ctrl+W followed by L
 *
 * Behavior:
 * - Single-key bindings execute immediately
 * - Multi-key bindings match exact sequences
 * - Modifier order is handled consistently (e.g., <C-A-s> matches both Ctrl+Alt+S and Alt+Ctrl+S)
 * - When a key sequence is a prefix of another binding:
 *   - The system waits for a timeout period
 *   - If the longer sequence is completed within the timeout, it executes
 *   - If no further keys are pressed within the timeout, the shorter binding executes
 *
 * Example:
 * ```js
 * {
 *   // Executes after timeout if no longer sequence
 *   '<C-a>': () => console.log('Select all'),
 *   // Executes after timeout if no longer sequence
 *   '<C-w>': () => console.log('Close window'),
 *   // Executes immediately if pressed within timeout
 *   '<C-w>l': () => console.log('Next window'),
 * }
 * ```
 *
 * @type {Record<string, KeyBindingAction> & { mac?: Record<string, KeyBindingAction>, linux?: Record<string, KeyBindingAction> }}
 */
const keybindings = {
  '<C-c>': () => {
    process.emit('SIGINT');
  },
  '<Mouse4>': ({ view }) => {
    view.focusedContent?.navigationHistory.goBack();
  },
  '<Mouse5>': ({ view }) => {
    view.focusedContent?.navigationHistory.goForward();
  },
  mac: {
    '<M-a>': ({ view }) => {
      view.focusedContent.selectAll();
    },
    '<M-]>': ({ view }) => {
      view.focusedContent?.navigationHistory.goForward();
    },
    '<M-[>': ({ view }) => {
      view.focusedContent?.navigationHistory.goBack();
    },
  },
  linux: {
    '<C-]>': ({ view }) => {
      view.focusedContent?.navigationHistory.goForward();
    },
    '<C-[>': ({ view }) => {
      view.focusedContent?.navigationHistory.goBack();
    },
  },
};

const config = {
  keybindings,
};

module.exports = config;
