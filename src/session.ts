import { app, session as ElectronSession, type Session } from 'electron';

export const sessionPromise = new Promise<Session>((resolve) => {
    app.whenReady().then(() => {
        resolve(ElectronSession.fromPartition('persist:custom'));
    });
}); 