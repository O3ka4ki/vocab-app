/**
 * Firebase 設定ファイル
 */
export const firebaseConfig = {
  apiKey: "AIzaSyAsRk1IwwhaUIvxY2S6n7M6NkDX4szf5jg",
  authDomain: "vocab-app-e76ce.firebaseapp.com",
  projectId: "vocab-app-e76ce",
  storageBucket: "vocab-app-e76ce.firebasestorage.app",
  messagingSenderId: "1098674843495",
  appId: "1:1098674843495:web:15abb74edbf0523c6b09c2",
  measurementId: "G-W1SB035873"
};

export function isFirebaseConfigured() {
  return firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey.startsWith("AIza");
}
