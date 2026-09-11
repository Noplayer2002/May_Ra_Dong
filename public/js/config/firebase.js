const firebaseConfig = {
    apiKey: "AIzaSyDKi7eC8WD7fi_lu2Lm9FxUwMBIPd23bcw",
    authDomain: "may-ra-dong.firebaseapp.com",
    databaseURL: "https://may-ra-dong-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "may-ra-dong",
    storageBucket: "may-ra-dong.firebasestorage.app",
    messagingSenderId: "777662906578",
    appId: "1:777662906578:web:7b52d7ed61fb868b112d0b",
    measurementId: "G-F61WGFMGQ6"
};

firebase.initializeApp(firebaseConfig);
export const db = firebase.database();