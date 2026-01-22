import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {NfcTechType} from './nfc';

export type TagDataParam = {
  uid: string;
  techTypes: NfcTechType[];
  sak?: number;
  atqa?: string;
  ats?: string;
  historicalBytes?: string;
};

export type RootStackParamList = {
  Home: undefined;
  Scan: undefined;
  Result: {
    tagData?: TagDataParam;
  };
};

export type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;
export type ScanScreenProps = NativeStackScreenProps<RootStackParamList, 'Scan'>;
export type ResultScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'Result'
>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
