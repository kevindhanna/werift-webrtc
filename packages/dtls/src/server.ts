import debug from "debug";
import { setTimeout } from "timers/promises";

import { SessionType } from "./cipher/suites/abstract";
import { flight2 } from "./flight/server/flight2";
import { Flight4 } from "./flight/server/flight4";
import { Flight6 } from "./flight/server/flight6";
import { HandshakeType } from "./handshake/const";
import { ClientHello } from "./handshake/message/client/hello";
import { FragmentedHandshake } from "./record/message/fragment";
import { DtlsSocket, Options } from "./socket";

const log = debug("werift-dtls : packages/dtls/src/server.ts : log");

export class DtlsServer extends DtlsSocket {
  constructor(options: Options) {
    super(options, SessionType.SERVER);
    this.onHandleHandshakes = this.handleHandshakes;
    log(this.dtls.sessionId, "start server");
  }

  private flight6!: Flight6;
  private handleHandshakes = async (assembled: FragmentedHandshake[]) => {
    log(
      this.dtls.sessionId,
      "handleHandshakes",
      assembled.map((a) => a.msg_type)
    );

    for (const handshake of assembled) {
      switch (handshake.msg_type) {
        case HandshakeType.client_hello_1:
          {
            const clientHello = ClientHello.deSerialize(handshake.fragment);

            if (
              this.dtls.cookie &&
              clientHello.cookie.equals(this.dtls.cookie)
            ) {
              log(this.dtls.sessionId, "send flight4");
              await new Flight4(
                this.transport,
                this.dtls,
                this.cipher,
                this.srtp
              ).exec(handshake, this.options.certificateRequest);
            } else if (!this.dtls.sessionId) {
              log(this.dtls.sessionId, "send flight2");
              flight2(
                this.transport,
                this.dtls,
                this.cipher,
                this.srtp
              )(clientHello);
            }
          }
          break;
        case HandshakeType.client_key_exchange_16:
          {
            if (this.connected) return;
            this.flight6 = new Flight6(this.transport, this.dtls, this.cipher);
            this.flight6.handleHandshake(handshake);
          }
          break;
        case HandshakeType.finished_20:
          {
            this.flight6.handleHandshake(handshake);

            for (let i = 0; i < 10; i++) {
              if (
                ![16].find(
                  (type) =>
                    this.dtls.sortedHandshakeCache.find(
                      (h) => h.msg_type === type
                    ) == undefined
                )
              ) {
                log(this.dtls.sessionId, "ready flight5", i);
                await this.flight6.exec();
                this.connected = true;
                this.onConnect.execute();
                log(this.dtls.sessionId, "dtls connected");
                break;
              } else {
                log(
                  this.dtls.sessionId,
                  "not arrived",
                  this.dtls.sortedHandshakeCache.map((h) => h.summary)
                );
                await setTimeout(100 * i);
              }
            }
          }
          break;
      }
    }
  };
}
