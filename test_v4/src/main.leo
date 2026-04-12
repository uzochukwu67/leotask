program test_v4.aleo {
    fn test_func(sig: signature, addr: address, val: field) -> bool {
        return sig.verify(addr, val);
    }
}
