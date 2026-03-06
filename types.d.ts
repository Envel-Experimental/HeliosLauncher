/**
 * Global types
 */

interface DistributionData {
    version: string;
    rss: string;
    servers: ServerData[];
}

interface ServerData {
    id: string;
    name: string;
    description: string;
    icon: string;
    version: string;
    address: string;
    minecraftVersion: string;
    mainServer: boolean;
    autoconnect?: boolean;
    javaOptions?: {
        supported?: string;
        distribution?: string;
        suggestedMajor?: number;
        platformOptions?: Array<{platform: string, architecture: string, distribution: string}>;
    };
    modules: ModuleData[];
}

interface ModuleData {
    id: string;
    name: string;
    type: string;
    artifact?: {
        size?: number;
        MD5?: string;
        url?: string;
        path?: string;
    };
    required?: {
        value?: boolean;
        def?: boolean;
    };
    subModules?: ModuleData[];
}

interface P2PMessage {
    type: string;
    payload: any;
}

declare var currentWindow: any;
declare var remoteApp: any;
declare var appVersion: string;
declare var currentWebContents: any;
declare var remoteDialog: any;

declare var remote: any;
declare var ipcRenderer: any;
declare var shell: any;
declare var ConfigManager: any;
declare var Lang: any;
declare var DistroAPI: any;
