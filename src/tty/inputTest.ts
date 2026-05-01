import { EscapeType, cleanupInput, listenForInput, setupInput } from 'glimpse-tty-native-rs';
import { format } from 'node:util';
import * as out from './output';

let quitListening = () => {};

const cleanup = (signum = 1) => {
  quitListening();
  cleanupInput();
  out.cleanup();
  process.exit(signum);
};

function main() {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGABRT', cleanup);
  out.setup();
  setupInput();
  process.stdout.write('Glimpse TTY Input Test\r\n');
  quitListening = listenForInput((evt) => {
    if (evt.type === EscapeType.Key && evt.code === 'c' && evt.modifiers.includes('ctrl')) {
      quitListening();
      cleanup(0);
    }
    process.stdout.write(format(evt, '\r\n'));
  });
}

main();
