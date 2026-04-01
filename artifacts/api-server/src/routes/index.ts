import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import customerDetailsRouter from "./customer-details";
import productsRouter from "./products";
import productAttributesRouter from "./product-attributes";
import productVariantsRouter from "./product-variants";
import suppliersRouter from "./suppliers";
import ordersRouter from "./orders";
import processStockRouter from "./process-stock";
import purchasingRouter from "./purchasing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(customersRouter);
router.use(customerDetailsRouter);
router.use(productsRouter);
router.use(productAttributesRouter);
router.use(productVariantsRouter);
router.use(suppliersRouter);
router.use(ordersRouter);
router.use(processStockRouter);
router.use(purchasingRouter);

export default router;
