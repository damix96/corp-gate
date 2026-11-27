import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { AppShellView } from './views/app-shell.js';
import { SecretInputView } from './views/secret-input-view.js';
import { isSecretInputPath } from './stores/navigation-store.js';

const isSecretInput = isSecretInputPath(location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <Notifications position="bottom-right" />
      <ModalsProvider>
        {isSecretInput ? <SecretInputView /> : <AppShellView />}
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
);
