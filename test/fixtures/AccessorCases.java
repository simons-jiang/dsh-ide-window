package demo;

import com.example.dep.QuoteInnerResp;
import org.mockito.ArgumentCaptor;

public class AccessorCases {

    void localVariable() {
        QuoteInnerResp older = quote();
        older.setBusinessDate(1L);
    }

    void chainedReceiver() {
        ArgumentCaptor<QuoteInnerResp> captor = ArgumentCaptor.forClass(QuoteInnerResp.class);
        captor.getValue().getBusinessDate();
    }

    void qualifiedGeneric() {
        org.mockito.ArgumentCaptor<QuoteInnerResp> qualified = org.mockito.ArgumentCaptor.forClass(QuoteInnerResp.class);
        qualified.getValue().getBusinessDate();
    }

    void methodReference() {
        list.stream().max(Comparator.comparing(QuoteInnerResp::getBusinessDate));
    }
}
