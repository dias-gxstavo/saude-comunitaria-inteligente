import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonFooter, IonContent, IonToolbar, IonTitle, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge, IonButton, IonList, IonItem, IonSpinner } from '@ionic/angular/standalone';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { informationCircleOutline, earthOutline, homeOutline, powerOutline } from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { BluetoothSerial } from '@awesome-cordova-plugins/bluetooth-serial/ngx';
import { firstValueFrom, Subscription } from 'rxjs';
import { AndroidPermissions } from '@awesome-cordova-plugins/android-permissions/ngx';
import { BleClient } from '@capacitor-community/bluetooth-le';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  providers: [BluetoothSerial, AndroidPermissions],
  imports: [
    CommonModule,
    IonFooter,
    IonContent,
    IonToolbar,
    IonTitle,
    IonTabBar,
    IonTabButton,
    IonIcon,
    IonLabel,
    IonBadge,
    IonButton,
    IonList,
    IonItem,
    IonSpinner,
    RouterLink,
  ],
})
export class HomePage {
  connecting = false;
  connected?: { id: string; name: string | null };
  scanning = false;
  errorMessage = '';
  infoMessage = '';
  // Estado do alarme ON/OFF
  alarmeAtivo = false;
  // Lista de dispositivos mapeados (pareados e não pareados)
  devices: Array<{ id: string; name: string | null; paired?: boolean }> = [];
  // Dispositivo atualmente tentando conectar (para desabilitar botão específico)
  connectingId?: string;
  // Assinatura ativa da conexão SPP (mantida aberta até desconectar)
  private btConnSub?: Subscription;

  constructor(private btSerial: BluetoothSerial, private androidPerms: AndroidPermissions) {
     addIcons({powerOutline,earthOutline,homeOutline,informationCircleOutline});
  }

  private async ensureBtEnabled() {
    if (Capacitor.getPlatform() !== 'android') return; // HC-06: foco em Android
    try {
      await this.btSerial.isEnabled();
    } catch {
      try {
        await this.btSerial.enable();
      } catch (e) {
        console.warn('Bluetooth enable:', e);
      }
    }
  }

  private async ensureRuntimePermissions() {
    if (Capacitor.getPlatform() !== 'android') return;
    const P = this.androidPerms.PERMISSION as any;
    // Android 12+
    try {
      await this.androidPerms.requestPermissions([
        P.BLUETOOTH_SCAN || 'android.permission.BLUETOOTH_SCAN',
        P.BLUETOOTH_CONNECT || 'android.permission.BLUETOOTH_CONNECT',
      ]);
    } catch (e) {
      console.warn('Permissões BLE (12+) não concedidas ou indisponíveis:', e);
    }
    // Android <= 11: localização pode ser exigida por descoberta
    try {
      await this.androidPerms.requestPermissions([
        P.ACCESS_COARSE_LOCATION || 'android.permission.ACCESS_COARSE_LOCATION',
        P.ACCESS_FINE_LOCATION || 'android.permission.ACCESS_FINE_LOCATION',
      ]);
    } catch (e) {
      console.warn('Permissões de localização não concedidas:', e);
    }
  }

  async conectarHC06() {
    this.connecting = true;
    try {
      await this.ensureBtEnabled();
      await this.ensureRuntimePermissions();

      console.log('[HC-06] Iniciando descoberta/conexão');
      // 1) Tente achar nos pareados
      let target: { id: string; name: string | null } | undefined;
      const nameMatchers = [/HC-06/i, /HC-05/i, /LINVOR/i, /^BT/i, /JDY/i];
      const matchDevice = (arr: any[] | undefined) => {
        if (!arr) return undefined;
        for (const dev of arr) {
          const nm = (dev.name || '').toString();
          if (nameMatchers.some(rx => rx.test(nm))) {
            return { id: dev.address || dev.id, name: dev.name || nm || 'HC-06' } as { id: string; name: string | null };
          }
        }
        return undefined;
      };
      try {
        const paired = await this.btSerial.list();
        console.log('[HC-06] Pareados:', paired);
        target = matchDevice(paired);
      } catch {}

      // 2) Se não achou, descobrir não pareados
      if (!target) {
        const unpaired = await this.btSerial.discoverUnpaired();
        console.log('[HC-06] Não pareados:', unpaired);
        target = matchDevice(unpaired || []);
      }

      if (!target) {
        throw new Error('HC-06 não encontrado. Emparelhe nas configurações ou ligue o módulo.');
      }

      // 3) Conectar (tenta seguro; se falhar, tenta insecure para SPP padrão)
      try {
        console.log('[HC-06] Conectando modo seguro a', target.id);
        await firstValueFrom(this.btSerial.connect(target.id));
      } catch (e1) {
        console.warn('[HC-06] Conexão segura falhou, tentando insecure...', e1);
        try {
          await firstValueFrom((this.btSerial as any).connectInsecure(target.id));
        } catch (e2) {
          console.error('[HC-06] Conexão insecure também falhou', e2);
          throw e2;
        }
      }
      this.connected = target;
    } catch (err) {
      console.error('Falha ao conectar ao HC-06', err);
    } finally {
      this.connecting = false;
    }
  }

  async desconectar() {
    try {
      // cancelar assinatura encerra a conexão no plugin
      if (this.btConnSub) {
        this.btConnSub.unsubscribe();
        this.btConnSub = undefined;
      } else {
        await this.btSerial.disconnect();
      }
    } catch {}
    this.connected = undefined;
    this.infoMessage = 'Desconectado.';
    this.alarmeAtivo = false;
  }

  // Mapeia dispositivos pareados e não pareados e popula lista
  async listarDispositivos() {
    this.scanning = true;
    this.devices = [];
    this.errorMessage = '';
    this.infoMessage = '';
    try {
      await this.ensureBtEnabled();
      await this.ensureRuntimePermissions();

      const normalize = (d: any, paired?: boolean) => ({
        id: (d && (d.address || d.id)) ?? '',
        name: (d && (d.name ?? null)) ?? null,
        paired,
      });

      const mapById = new Map<string, { id: string; name: string | null; paired?: boolean }>();

      // Pareados
      try {
        const paired = await this.btSerial.list();
        for (const d of paired || []) {
          const n = normalize(d, true);
          if (n.id) mapById.set(n.id, n);
        }
      } catch (e) {
        console.warn('Falha ao obter pareados:', e);
      }

      // Não pareados
      try {
        const un = await this.btSerial.discoverUnpaired();
        for (const d of un || []) {
          const n = normalize(d, false);
          if (n.id && !mapById.has(n.id)) mapById.set(n.id, n);
        }
      } catch (e) {
        console.warn('Falha ao descobrir não pareados:', e);
      }

      // Ordena: pareados primeiro, depois por nome
      this.devices = Array.from(mapById.values()).sort((a, b) => {
        const ap = a.paired ? 0 : 1;
        const bp = b.paired ? 0 : 1;
        if (ap !== bp) return ap - bp;
        const an = (a.name || '').toString().toLowerCase();
        const bn = (b.name || '').toString().toLowerCase();
        return an.localeCompare(bn);
      });

      if (this.devices.length === 0) {
        this.infoMessage = 'Nenhum dispositivo encontrado. Verifique se o Bluetooth está ligado e a Localização (Android ≤ 11).';
      }
    } catch (e) {
      console.error('Listagem falhou', e);
      this.errorMessage = 'Falha ao listar dispositivos. Verifique permissões e o estado do Bluetooth.';
    } finally {
      this.scanning = false;
    }
  }

  private delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }

  async conectarDispositivo(dev: { id: string; name: string | null; paired?: boolean }) {
    if (!dev?.id) return;
    this.connectingId = dev.id;
    this.errorMessage = '';
    this.infoMessage = '';
    try {
      await this.ensureBtEnabled();
      await this.ensureRuntimePermissions();
      // pequena pausa para garantir que o discovery terminou (conectar durante discovery falha em muitos aparelhos)
      await this.delay(800);

      // Se já há conexão, encerra antes
      if (this.btConnSub) {
        try { this.btConnSub.unsubscribe(); } catch {}
        this.btConnSub = undefined;
        await this.delay(200);
      }

      const preferInsecure = !dev.paired; // HC-06 sem pareamento: costuma exigir insecure
      const tryConnect = (insecure: boolean) => insecure
        ? (this.btSerial as any).connectInsecure(dev.id)
        : this.btSerial.connect(dev.id);

      const startConnection = (insecureFirst: boolean) => new Promise<void>((resolve, reject) => {
        const firstObs = tryConnect(insecureFirst);
        let triedSecond = false;
        const onError = (e: any) => {
          console.warn(`Conexão ${insecureFirst ? 'insecure' : 'secure'} falhou:`, e);
          this.btConnSub?.unsubscribe();
          this.btConnSub = undefined;
          if (!triedSecond) {
            triedSecond = true;
            const secondObs = tryConnect(!insecureFirst);
            this.btConnSub = secondObs.subscribe(
              () => resolve(),
              (e2: any) => reject(e2)
            );
          } else {
            reject(e);
          }
        };
        this.btConnSub = firstObs.subscribe(
          () => resolve(),
          onError
        );
      });

      await startConnection(preferInsecure);

      this.connected = { id: dev.id, name: dev.name ?? null };
      this.infoMessage = `Conectado a ${dev.name || dev.id}`;
  // estado inicial: LED vermelho (OFF) — usa CRLF por compatibilidade
  try { await this.btSerial.write('OFF\r\n'); } catch {}
      this.alarmeAtivo = false;
    } catch (e) {
      console.error('Falha ao conectar', e);
      this.errorMessage = 'Falha ao conectar. Se não estiver pareado, tente parear nas Configurações do Android (PIN 1234) e tente novamente.';
    } finally {
      this.connectingId = undefined;
    }
  }

  async toggleAlarme() {
    if (!this.connected) return;
    this.errorMessage = '';
    try {
      if (!this.alarmeAtivo) {
        for (let i = 0; i < 3; i++) {
          await this.btSerial.write('ON\r\n');
        }
        await this.delay(120); // delay mais rápido para troca de cor
        this.alarmeAtivo = true;
        this.infoMessage = 'Alarme ativado.';
      } else {
        for (let i = 0; i < 3; i++) {
          await this.btSerial.write('OFF\r\n');
        }
        await this.delay(120); // delay mais rápido para troca de cor
        this.alarmeAtivo = false;
        this.infoMessage = 'Alarme desativado.';
      }
    } catch (e) {
      this.errorMessage = 'Não foi possível enviar comando ao módulo.';
      console.error(e);
    }
  }

  // ...existing code...

  async abrirConfiguracoesBluetooth() {
    try { await BleClient.openBluetoothSettings(); } catch {}
  }

  async abrirConfiguracoesLocalizacao() {
    try { await BleClient.openLocationSettings(); } catch {}
  }
}
