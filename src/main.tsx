import {createRoot} from 'react-dom/client';
import App from './App';
import './styles.css';
import {registerExplorerTools} from './services/webmcp';
import {AppBoundary} from './components/AppBoundary';
createRoot(document.getElementById('root')!).render(<AppBoundary><App/></AppBoundary>);
registerExplorerTools();
