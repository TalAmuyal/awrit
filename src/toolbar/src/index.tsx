/* @refresh reload */
console.log('toolbar');
import { render } from 'solid-js/web';
import './index.css';
import { Toolbar } from './Toolbar';

const root = document.getElementById('root');
// biome-ignore lint/style/noNonNullAssertion: trust the root
render(() => <Toolbar />, root!);
