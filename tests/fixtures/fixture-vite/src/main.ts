import { createApp } from "vue";
import App from "./App.vue";
import { api } from "@/api";
const views = import.meta.glob("./views/known/*.vue");
createApp(App).mount("#app");
void api;
void views;
