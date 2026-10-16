import { describe, it, expect } from "vitest";
import { repairMojibake } from "../src/server/wsServer";

describe("repairMojibake — conserta nomes com UTF-8 lido como Latin-1", () => {
  it("repara o caso real do ranking", () => {
    expect(repairMojibake("FabrÃ­cio Carvalho")).toBe("Fabrício Carvalho");
  });
  it("repara outros acentos comuns", () => {
    expect(repairMojibake("JoÃ£o")).toBe("João");
    expect(repairMojibake("AndrÃ©")).toBe("André");
    expect(repairMojibake("ConceiÃ§Ã£o")).toBe("Conceição");
  });
  it("NÃO toca em nomes já corretos (acentuados ou não)", () => {
    expect(repairMojibake("Fabrício Carvalho")).toBe("Fabrício Carvalho");
    expect(repairMojibake("João")).toBe("João");
    expect(repairMojibake("Ramon Braga")).toBe("Ramon Braga");
    expect(repairMojibake("Kayque")).toBe("Kayque");
  });
  it("tolera entradas vazias/estranhas sem quebrar", () => {
    expect(repairMojibake("")).toBe("");
    expect(repairMojibake(null)).toBe(null);
    expect(repairMojibake(undefined)).toBe(undefined);
    expect(repairMojibake("名前")).toBe("名前"); // fora do Latin-1 → intocado
  });
});
