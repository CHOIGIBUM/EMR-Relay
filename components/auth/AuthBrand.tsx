import Image from "next/image";
import Link from "next/link";
import styles from "./Auth.module.css";

export default function AuthBrand() {
  return (
    <Link className={styles.brand} href="/" aria-label="EMS Relay 홈">
      <Image src="/ems-relay-icon.png" width={52} height={52} alt="" priority />
      <span><strong>EMS Relay</strong><small>응급환자 정보 연계</small></span>
    </Link>
  );
}
