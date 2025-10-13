import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'extensaoProject',
  webDir: 'www',
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Procurando...',
        cancel: 'Cancelar',
        availableDevices: 'Dispositivos disponíveis',
        noDeviceFound: 'Nenhum dispositivo encontrado'
      }
    }
  }
};

export default config;
